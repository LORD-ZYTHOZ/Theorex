// theronexus-proxy.test.ts — Phase 7.5: Theronexus MCP Proxy

import { test, expect, describe } from "bun:test";

// ---------------------------------------------------------------------------
// Pull the pure functions out for unit testing
// ---------------------------------------------------------------------------

const REBRAND: ReadonlyArray<readonly [RegExp, string]> = [
  [/GitNexus/g, "Theronexus"],
  [/gitnexus/g, "theronexus"],
] as const;

function applyRebrand(line: string): string {
  let out = line;
  for (const [pattern, replacement] of REBRAND) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

const INBOUND: ReadonlyArray<readonly [RegExp, string]> = [
  [/theronexus_/g, "gitnexus_"],
  [/theronexus:\/\//g, "gitnexus://"],
] as const;

function applyInbound(line: string): string {
  let out = line;
  for (const [pattern, replacement] of INBOUND) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function makeLineBuffer(onLine: (line: string) => void) {
  let buf = "";
  return {
    push(chunk: string): void {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim() !== "") onLine(line);
      }
    },
    flush(): void {
      if (buf.trim() !== "") {
        onLine(buf);
        buf = "";
      }
    },
  };
}

// ---------------------------------------------------------------------------
// applyRebrand
// ---------------------------------------------------------------------------

describe("applyRebrand", () => {
  test("replaces GitNexus with Theronexus", () => {
    expect(applyRebrand("GitNexus code intelligence")).toBe("Theronexus code intelligence");
  });

  test("replaces gitnexus with theronexus (lowercase)", () => {
    expect(applyRebrand('{"name":"gitnexus"}')).toBe('{"name":"theronexus"}');
  });

  test("replaces all occurrences in a single line", () => {
    const input = '{"server":"GitNexus","vendor":"gitnexus"}';
    const output = applyRebrand(input);
    expect(output).toBe('{"server":"Theronexus","vendor":"theronexus"}');
  });

  test("leaves unrelated strings unchanged", () => {
    const line = '{"jsonrpc":"2.0","method":"tools/list"}';
    expect(applyRebrand(line)).toBe(line);
  });

  test("handles empty string", () => {
    expect(applyRebrand("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// applyInbound
// ---------------------------------------------------------------------------

describe("applyInbound", () => {
  test("reverses theronexus_ tool names back to gitnexus_", () => {
    expect(applyInbound('{"method":"tools/call","params":{"name":"theronexus_query"}}')).toBe(
      '{"method":"tools/call","params":{"name":"gitnexus_query"}}',
    );
  });

  test("reverses theronexus:// URIs back to gitnexus://", () => {
    expect(applyInbound("theronexus://repo/x")).toBe("gitnexus://repo/x");
  });

  test("replaces all theronexus_ occurrences in a single line", () => {
    const input = '{"a":"theronexus_query","b":"theronexus_context"}';
    expect(applyInbound(input)).toBe('{"a":"gitnexus_query","b":"gitnexus_context"}');
  });

  test("leaves unrelated strings unchanged", () => {
    const line = '{"jsonrpc":"2.0","method":"tools/list"}';
    expect(applyInbound(line)).toBe(line);
  });

  test("handles empty string", () => {
    expect(applyInbound("")).toBe("");
  });

  test("does not reverse Theronexus display strings", () => {
    const line = '{"serverName":"Theronexus","tool":"theronexus_query"}';
    expect(applyInbound(line)).toBe('{"serverName":"Theronexus","tool":"gitnexus_query"}');
  });
});

// ---------------------------------------------------------------------------
// makeLineBuffer
// ---------------------------------------------------------------------------

describe("makeLineBuffer", () => {
  test("emits complete lines", () => {
    const lines: string[] = [];
    const buf = makeLineBuffer((l) => lines.push(l));
    buf.push('{"a":1}\n{"b":2}\n');
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  test("buffers partial lines across pushes", () => {
    const lines: string[] = [];
    const buf = makeLineBuffer((l) => lines.push(l));
    buf.push('{"a":');
    expect(lines).toHaveLength(0);
    buf.push('1}\n');
    expect(lines).toEqual(['{"a":1}']);
  });

  test("flush emits remaining buffered content", () => {
    const lines: string[] = [];
    const buf = makeLineBuffer((l) => lines.push(l));
    buf.push('{"z":9}');
    expect(lines).toHaveLength(0);
    buf.flush();
    expect(lines).toEqual(['{"z":9}']);
  });

  test("skips blank lines", () => {
    const lines: string[] = [];
    const buf = makeLineBuffer((l) => lines.push(l));
    buf.push("\n\n\n");
    expect(lines).toHaveLength(0);
  });
});
