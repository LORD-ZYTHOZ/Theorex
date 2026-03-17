// code/parse-multi.ts — Regex-based AST parser for Python and Go.
// Phase 7b: Multi-language code reading.
//
// Deliberately regex-based (not tree-sitter) to avoid native binding issues with Bun.
// Accurate enough for symbol extraction: functions, classes, methods.
// Call edges are extracted where possible (Python: direct calls; Go: function calls).

import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import type { CodeSymbol, CodeCall, ParseResult } from "./parse";

// ---------------------------------------------------------------------------
// Python parser
// ---------------------------------------------------------------------------

export async function parsePython(filePath: string, rootDir = ""): Promise<ParseResult> {
  let text: string;
  try { text = await readFile(filePath, "utf-8"); } catch { return { filePath, symbols: [], calls: [] }; }

  const displayPath = rootDir ? relative(rootDir, filePath) : filePath;
  const lines = text.split("\n");
  const symbols: CodeSymbol[] = [];
  const calls: CodeCall[] = [];

  // Track class context by indentation level
  const classStack: Array<{ name: string; indent: number }> = [];

  // Regex patterns
  const classPat  = /^(\s*)class\s+([A-Za-z_][A-Za-z0-9_]*)\s*[:(]/;
  const defPat    = /^(\s*)(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
  const callPat   = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;

    // Pop classes whose indentation we've exited.
    // Skip blank lines — they have indent 0 and would incorrectly pop indent-0 classes.
    if (!line.trim()) continue;
    const currentIndent = line.match(/^(\s*)/)?.[1].length ?? 0;
    while (classStack.length > 0 && currentIndent <= classStack[classStack.length - 1]!.indent) {
      classStack.pop();
    }

    const classMatch = line.match(classPat);
    if (classMatch) {
      const indent = classMatch[1]!.length;
      const name = classMatch[2]!;
      symbols.push({ name, filePath: displayPath, line: lineNum, kind: "class" });
      classStack.push({ name, indent });
      continue;
    }

    if (line.trim().startsWith("@")) continue;
    const defMatch = line.match(defPat);
    if (defMatch) {
      const rawName = defMatch[2]!;
      const currentClass = classStack[classStack.length - 1];
      const name = currentClass ? `${currentClass.name}.${rawName}` : rawName;
      const kind: CodeSymbol["kind"] = currentClass ? "method" : "function";
      symbols.push({ name, filePath: displayPath, line: lineNum, kind });

      // Collect calls in the next lines until next def/class at same or lower indent
      const defIndent = defMatch[1]!.length;
      for (let j = i + 1; j < lines.length; j++) {
        const bodyLine = lines[j]!;
        const bodyIndent = bodyLine.match(/^(\s*)/)?.[1].length ?? 0;
        if (bodyLine.trim() && bodyIndent <= defIndent) break;
        let m: RegExpExecArray | null;
        callPat.lastIndex = 0;
        while ((m = callPat.exec(bodyLine)) !== null) {
          const callee = m[1]!;
          const PY_SKIP = new Set(["def","class","if","elif","else","for","while","return","print",
            "len","range","super","isinstance","async","await","yield","lambda","with","try",
            "except","finally","raise","assert","pass","break","continue","del","global",
            "nonlocal","import","from","as","is","in","and","or","not",rawName]);
          if (!PY_SKIP.has(callee)) {
            calls.push({ callerName: name, calleeName: callee, filePath: displayPath });
          }
        }
      }
    }
  }

  return { filePath: displayPath, symbols, calls };
}

// ---------------------------------------------------------------------------
// Go parser
// ---------------------------------------------------------------------------

export async function parseGo(filePath: string, rootDir = ""): Promise<ParseResult> {
  let text: string;
  try { text = await readFile(filePath, "utf-8"); } catch { return { filePath, symbols: [], calls: [] }; }

  const displayPath = rootDir ? relative(rootDir, filePath) : filePath;
  const lines = text.split("\n");
  const symbols: CodeSymbol[] = [];
  const calls: CodeCall[] = [];

  // func Name(      — top-level function
  const funcPat   = /^func\s+([A-Z][A-Za-z0-9_]*|[a-z][A-Za-z0-9_]*)\s*\(/;
  // func (recv Type) Name(  — method
  const methodPat = /^func\s+\([^)]*\b([A-Za-z_][A-Za-z0-9_]*)\s*\)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
  // type Name struct / type Name interface
  const structPat    = /^type\s+([A-Za-z_][A-Za-z0-9_]*)\s+struct/;
  const interfacePat = /^type\s+([A-Za-z_][A-Za-z0-9_]*)\s+interface/;
  const callPat   = /\b([a-z][A-Za-z0-9_]*)\s*\(/g;

  // Track current function for call extraction
  let currentFunc = "";
  let braceDepth = 0;
  let inFunc = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;

    const structMatch = line.match(structPat);
    if (structMatch) {
      symbols.push({ name: structMatch[1]!, filePath: displayPath, line: lineNum, kind: "class" });
    }
    const interfaceMatch = line.match(interfacePat);
    if (interfaceMatch) {
      symbols.push({ name: interfaceMatch[1]!, filePath: displayPath, line: lineNum, kind: "class" });
    }

    const methodMatch = line.match(methodPat);
    if (methodMatch) {
      const name = `${methodMatch[1]!}.${methodMatch[2]!}`;
      symbols.push({ name, filePath: displayPath, line: lineNum, kind: "method" });
      currentFunc = name;
      inFunc = true;
      braceDepth = 0;
    } else {
      const funcMatch = line.match(funcPat);
      if (funcMatch) {
        const name = funcMatch[1]!;
        symbols.push({ name, filePath: displayPath, line: lineNum, kind: "function" });
        currentFunc = name;
        inFunc = true;
        braceDepth = 0;
      }
    }

    if (inFunc) {
      braceDepth += (line.match(/\{/g) ?? []).length;
      braceDepth -= (line.match(/\}/g) ?? []).length;
      if (braceDepth <= 0 && line.includes("}")) { inFunc = false; currentFunc = ""; }

      // Extract calls from function body
      if (currentFunc) {
        let m: RegExpExecArray | null;
        callPat.lastIndex = 0;
        while ((m = callPat.exec(line)) !== null) {
          const callee = m[1]!;
          if (callee !== currentFunc && callee !== "func" && callee !== "if" &&
              callee !== "for" && callee !== "switch" && callee !== "select" &&
              callee !== "make" && callee !== "new" && callee !== "len" && callee !== "cap") {
            calls.push({ callerName: currentFunc, calleeName: callee, filePath: displayPath });
          }
        }
      }
    }
  }

  return { filePath: displayPath, symbols, calls };
}
