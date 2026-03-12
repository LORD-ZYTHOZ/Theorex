// code/parse.ts — TypeScript/JavaScript AST parser for Phase 7 (Code Reading).
// Extracts function/class/method symbols and call-graph edges from source files.
//
// Uses the official `typescript` compiler API for accurate AST traversal.
// Emits two structures per file:
//   - CodeSymbol: a named function, class, or method (becomes an axon node)
//   - CodeCall: a call from one symbol to another (becomes an axon edge)

import * as ts from "typescript";
import { readFile } from "node:fs/promises";
import { relative } from "node:path";

export interface CodeSymbol {
  readonly name: string;       // qualified name, e.g. "AxonStore.mergeNode"
  readonly filePath: string;
  readonly line: number;
  readonly kind: "function" | "class" | "method" | "arrow";
}

export interface CodeCall {
  readonly callerName: string;
  readonly calleeName: string;
  readonly filePath: string;
}

export interface ParseResult {
  readonly filePath: string;
  readonly symbols: readonly CodeSymbol[];
  readonly calls: readonly CodeCall[];
}

/**
 * Walk a subtree collecting CallExpression callee names.
 * Only captures identifiers and property accesses (e.g. store.save → "save").
 */
function collectCalls(
  node: ts.Node,
  callerName: string,
  filePath: string,
  source: ts.SourceFile,
  out: CodeCall[],
): void {
  if (ts.isCallExpression(node)) {
    const expr = node.expression;
    let callee = "";
    if (ts.isIdentifier(expr)) {
      callee = expr.text;
    } else if (ts.isPropertyAccessExpression(expr)) {
      callee = expr.name.text;
    }
    if (callee && callee !== callerName) {
      out.push({ callerName, calleeName: callee, filePath });
    }
  }
  ts.forEachChild(node, (child) => collectCalls(child, callerName, filePath, source, out));
}

/**
 * Parse a single TypeScript or JavaScript file.
 * Returns all top-level and class-member symbols plus their outgoing calls.
 */
export async function parseFile(filePath: string, rootDir = ""): Promise<ParseResult> {
  let text: string;
  try {
    text = await readFile(filePath, "utf-8");
  } catch {
    return { filePath, symbols: [], calls: [] };
  }

  // Display path relative to root if provided
  const displayPath = rootDir ? relative(rootDir, filePath) : filePath;

  const source = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.Unknown, // auto-detect TS/JS/TSX
  );

  const symbols: CodeSymbol[] = [];
  const calls: CodeCall[] = [];

  function line(node: ts.Node): number {
    return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  }

  function visit(node: ts.Node, className = ""): void {
    if (ts.isFunctionDeclaration(node) && node.name) {
      const name = node.name.text;
      symbols.push({ name, filePath: displayPath, line: line(node), kind: "function" });
      collectCalls(node, name, displayPath, source, calls);
      // Don't descend further — nested functions handled at next visit level
    } else if (ts.isClassDeclaration(node) && node.name) {
      const name = node.name.text;
      symbols.push({ name, filePath: displayPath, line: line(node), kind: "class" });
      ts.forEachChild(node, (child) => visit(child, name));
      return;
    } else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
      const name = className ? `${className}.${node.name.text}` : node.name.text;
      symbols.push({ name, filePath: displayPath, line: line(node), kind: "method" });
      collectCalls(node, name, displayPath, source, calls);
    } else if (ts.isVariableStatement(node)) {
      // Capture: const foo = () => {} or const foo = function() {}
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
        ) {
          const name = className ? `${className}.${decl.name.text}` : decl.name.text;
          symbols.push({ name, filePath: displayPath, line: line(decl), kind: "arrow" });
          collectCalls(decl.initializer, name, displayPath, source, calls);
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, className));
  }

  visit(source);

  return { filePath: displayPath, symbols, calls };
}
