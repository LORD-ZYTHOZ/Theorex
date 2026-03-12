// parse-multi.test.ts — Phase 7b: unit tests for Python and Go regex parsers.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parsePython, parseGo } from "./parse-multi";

const TMP = join(tmpdir(), "theorex-parse-multi-test-" + Date.now());

beforeAll(() => mkdir(TMP, { recursive: true }));
afterAll(async () => {
  for (const f of ["sample.py", "sample.go", "empty.py"]) {
    await unlink(join(TMP, f)).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

describe("parsePython", () => {
  test("extracts top-level functions", async () => {
    const src = `
def foo(x):
    return x * 2

def bar():
    pass
`;
    const path = join(TMP, "sample.py");
    await writeFile(path, src);
    const result = await parsePython(path);
    const names = result.symbols.map((s) => s.name);
    expect(names).toContain("foo");
    expect(names).toContain("bar");
  });

  test("extracts class and method names as ClassName.method", async () => {
    const src = `
class MyClass:
    def __init__(self):
        pass

    def compute(self, x):
        return x
`;
    const path = join(TMP, "sample.py");
    await writeFile(path, src);
    const result = await parsePython(path);
    const names = result.symbols.map((s) => s.name);
    expect(names).toContain("MyClass");
    expect(names).toContain("MyClass.__init__");
    expect(names).toContain("MyClass.compute");
  });

  test("skips decorator lines — does not consume def line (#6 fix)", async () => {
    const src = `
class Foo:
    @staticmethod
    def static_method():
        pass

    @classmethod
    def class_method(cls):
        pass

@some_decorator
def top_level():
    pass
`;
    const path = join(TMP, "sample.py");
    await writeFile(path, src);
    const result = await parsePython(path);
    const names = result.symbols.map((s) => s.name);
    expect(names).toContain("Foo.static_method");
    expect(names).toContain("Foo.class_method");
    expect(names).toContain("top_level");
  });

  test("extracts async functions", async () => {
    const src = `
async def fetch_data(url):
    pass
`;
    const path = join(TMP, "sample.py");
    await writeFile(path, src);
    const result = await parsePython(path);
    const names = result.symbols.map((s) => s.name);
    expect(names).toContain("fetch_data");
  });

  test("extracts call edges from function body", async () => {
    const src = `
def alpha():
    beta()
    gamma()

def beta():
    pass

def gamma():
    pass
`;
    const path = join(TMP, "sample.py");
    await writeFile(path, src);
    const result = await parsePython(path);
    const callers = result.calls.map((c) => c.callerName);
    expect(callers).toContain("alpha");
    const callees = result.calls.map((c) => c.calleeName);
    expect(callees).toContain("beta");
    expect(callees).toContain("gamma");
  });

  test("returns empty arrays for empty file", async () => {
    const path = join(TMP, "empty.py");
    await writeFile(path, "");
    const result = await parsePython(path);
    expect(result.symbols).toHaveLength(0);
    expect(result.calls).toHaveLength(0);
  });

  test("uses displayPath relative to rootDir", async () => {
    const src = "def foo(): pass\n";
    const path = join(TMP, "sample.py");
    await writeFile(path, src);
    const result = await parsePython(path, TMP);
    expect(result.filePath).toBe("sample.py");
  });
});

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

describe("parseGo", () => {
  test("extracts top-level functions", async () => {
    const src = `package main

func Hello() string {
    return "hello"
}

func add(a, b int) int {
    return a + b
}
`;
    const path = join(TMP, "sample.go");
    await writeFile(path, src);
    const result = await parseGo(path);
    const names = result.symbols.map((s) => s.name);
    expect(names).toContain("Hello");
    expect(names).toContain("add");
  });

  test("extracts struct types (as class kind)", async () => {
    const src = `package main

type Server struct {
    port int
}
`;
    const path = join(TMP, "sample.go");
    await writeFile(path, src);
    const result = await parseGo(path);
    const names = result.symbols.map((s) => s.name);
    expect(names).toContain("Server");
    const kinds = result.symbols.map((s) => s.kind);
    expect(kinds).toContain("class");
  });

  test("extracts receiver methods", async () => {
    const src = `package main

type Foo struct{}

func (f Foo) Bar() int {
    return 1
}

func (f *Foo) Baz() {
}
`;
    const path = join(TMP, "sample.go");
    await writeFile(path, src);
    const result = await parseGo(path);
    const names = result.symbols.map((s) => s.name);
    expect(names).toContain("Bar");
    expect(names).toContain("Baz");
    const kinds = result.symbols.map((s) => s.kind);
    expect(kinds).toContain("method");
  });

  test("extracts call edges from function body", async () => {
    const src = `package main

func alpha() {
    beta()
}

func beta() {}
`;
    const path = join(TMP, "sample.go");
    await writeFile(path, src);
    const result = await parseGo(path);
    const callers = result.calls.map((c) => c.callerName);
    expect(callers).toContain("alpha");
    const callees = result.calls.map((c) => c.calleeName);
    expect(callees).toContain("beta");
  });

  test("returns empty arrays for empty file", async () => {
    const path = join(TMP, "sample.go");
    await writeFile(path, "");
    const result = await parseGo(path);
    expect(result.symbols).toHaveLength(0);
    expect(result.calls).toHaveLength(0);
  });
});
