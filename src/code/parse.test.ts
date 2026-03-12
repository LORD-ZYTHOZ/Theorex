// parse.test.ts — Phase 7 Code Reading: unit tests for AST parser.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseFile } from "./parse";

const TMP = join(tmpdir(), "theorex-parse-test-" + Date.now());

beforeAll(() => mkdir(TMP, { recursive: true }));
afterAll(async () => {
  await unlink(join(TMP, "sample.ts")).catch(() => {});
  await unlink(join(TMP, "empty.ts")).catch(() => {});
});

describe("parseFile", () => {
  test("extracts top-level function declarations", async () => {
    const src = `
export function greet(name: string): string {
  return "hello " + name;
}
function helper() {}
`;
    const path = join(TMP, "sample.ts");
    await writeFile(path, src);

    const result = await parseFile(path);
    const names = result.symbols.map((s) => s.name);
    expect(names).toContain("greet");
    expect(names).toContain("helper");
  });

  test("extracts class and method names as ClassName.method", async () => {
    const src = `
class Foo {
  bar() { return 1; }
  baz() { return 2; }
}
`;
    const path = join(TMP, "sample.ts");
    await writeFile(path, src);

    const result = await parseFile(path);
    const names = result.symbols.map((s) => s.name);
    expect(names).toContain("Foo");
    expect(names).toContain("Foo.bar");
    expect(names).toContain("Foo.baz");
  });

  test("extracts arrow function assigned to const", async () => {
    const src = `const compute = (x: number) => x * 2;`;
    const path = join(TMP, "sample.ts");
    await writeFile(path, src);

    const result = await parseFile(path);
    const names = result.symbols.map((s) => s.name);
    expect(names).toContain("compute");
  });

  test("extracts call edges", async () => {
    const src = `
function alpha() { beta(); }
function beta() { return 1; }
`;
    const path = join(TMP, "sample.ts");
    await writeFile(path, src);

    const result = await parseFile(path);
    const callers = result.calls.map((c) => c.callerName);
    expect(callers).toContain("alpha");
    const callees = result.calls.map((c) => c.calleeName);
    expect(callees).toContain("beta");
  });

  test("returns empty arrays for empty file", async () => {
    const path = join(TMP, "empty.ts");
    await writeFile(path, "");
    const result = await parseFile(path);
    expect(result.symbols).toHaveLength(0);
    expect(result.calls).toHaveLength(0);
  });

  test("symbol has correct kind", async () => {
    const src = `
function fn() {}
class Cls {}
const arr = () => {};
`;
    const path = join(TMP, "sample.ts");
    await writeFile(path, src);

    const result = await parseFile(path);
    const byKind = Object.fromEntries(result.symbols.map((s) => [s.name, s.kind]));
    expect(byKind["fn"]).toBe("function");
    expect(byKind["Cls"]).toBe("class");
    expect(byKind["arr"]).toBe("arrow");
  });
});
