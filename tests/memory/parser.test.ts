import { test, expect, describe } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { parseMemory, serializeMemory } from "../../src/memory/parser";

describe("parseMemory", () => {
  test("parses preamble and single section", () => {
    const raw = "# Memory\n\n## System\nhello\n";
    const parsed = parseMemory(raw);
    expect(parsed.preamble).toBe("# Memory\n\n");
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].heading).toBe("## System");
    expect(parsed.sections[0].rawBody).toBe("\nhello\n");
  });

  test("round-trip with simple synthetic string", () => {
    const simple = "# Memory\n\n## Section One\n\nSome content here.\n\n## Section Two\n\nOther content.\n";
    const parsed = parseMemory(simple);
    const serialized = serializeMemory(parsed);
    expect(serialized).toBe(simple);
  });

  test("HARD GATE: round-trip with actual MEMORY.md", () => {
    const memoryPath = "/Users/eoh/.claude/projects/-Users-eoh/memory/MEMORY.md";
    if (!existsSync(memoryPath)) {
      console.log("SKIP: MEMORY.md not found at", memoryPath);
      return;
    }
    const raw = readFileSync(memoryPath, "utf-8");
    const parsed = parseMemory(raw);
    const serialized = serializeMemory(parsed);
    if (serialized !== raw) {
      // Debug info on failure
      console.error("Length raw:", raw.length, "serialized:", serialized.length);
      for (let i = 0; i < Math.max(raw.length, serialized.length); i++) {
        if (raw[i] !== serialized[i]) {
          console.error(`First diff at index ${i}: raw[${i}]=${JSON.stringify(raw[i])} serialized[${i}]=${JSON.stringify(serialized[i])}`);
          console.error("Context raw:", JSON.stringify(raw.slice(Math.max(0, i - 20), i + 20)));
          console.error("Context ser:", JSON.stringify(serialized.slice(Math.max(0, i - 20), i + 20)));
          break;
        }
      }
    }
    expect(serialized).toBe(raw);
  });

  test("parses multiple sections with correct section count and headings", () => {
    const raw = "# Memory\n\n## Tools\n\nContent.\n\n## System\n\nMore content.\n\n## Notes\n\nFinal.\n";
    const parsed = parseMemory(raw);
    expect(parsed.sections).toHaveLength(3);
    expect(parsed.sections[0].heading).toBe("## Tools");
    expect(parsed.sections[1].heading).toBe("## System");
    expect(parsed.sections[2].heading).toBe("## Notes");
  });

  test("H3 headers inside section body are preserved as raw body text", () => {
    const raw = "# Memory\n\n## System\n\n### Subsection\n\nData here.\n";
    const parsed = parseMemory(raw);
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].heading).toBe("## System");
    expect(parsed.sections[0].rawBody).toContain("### Subsection");
  });

  test("empty string input → empty preamble and empty sections", () => {
    const parsed = parseMemory("");
    expect(parsed.preamble).toBe("");
    expect(parsed.sections).toHaveLength(0);
  });
});
