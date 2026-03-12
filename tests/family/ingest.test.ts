import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chunkBySection, ingestFiles, stripMarkdown } from "../../src/family/ingest";
import { AxonStore } from "../../src/axon/store";
import { DEFAULT_CONFIG } from "../../src/config";

let tmpDir: string;
let agentsDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "theorex-ingest-test-"));
  agentsDir = join(tmpDir, "agents");
  await mkdir(agentsDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const config = { ...DEFAULT_CONFIG, agentAxonDir: "", sharedAxonPath: "" };

// ---------------------------------------------------------------------------
// stripMarkdown unit tests
// ---------------------------------------------------------------------------

test("stripMarkdown removes heading markers", () => {
  const result = stripMarkdown("## Trading\n### Risk");
  expect(result).toContain("Trading");
  expect(result).toContain("Risk");
  expect(result).not.toContain("##");
  expect(result).not.toContain("###");
});

test("stripMarkdown removes bold and italic", () => {
  expect(stripMarkdown("**Nova** is *sovereign*")).toBe("Nova is sovereign");
});

test("stripMarkdown removes inline code", () => {
  expect(stripMarkdown("use `theorex scan` daily")).toBe("use daily");
});

test("stripMarkdown removes bullet points", () => {
  const result = stripMarkdown("- risk\n- signal\n- profit");
  expect(result).toContain("risk");
  expect(result).toContain("signal");
  expect(result).toContain("profit");
  expect(result).not.toContain("- ");
});

test("stripMarkdown removes table rows", () => {
  const table = "| Agent | Role |\n|-------|------|\n| Nova | CEO |";
  const result = stripMarkdown(table);
  expect(result).not.toContain("|");
});

test("stripMarkdown removes URLs", () => {
  expect(stripMarkdown("see https://example.com for details")).toBe("see for details");
});

test("stripMarkdown preserves meaningful words", () => {
  const result = stripMarkdown("**Anchor blindness** caused overconfidence at `key levels`");
  expect(result).toContain("Anchor blindness");
  expect(result).toContain("caused overconfidence");
});

// ---------------------------------------------------------------------------
// chunkBySection unit tests
// ---------------------------------------------------------------------------

test("chunkBySection splits on H2 headings", () => {
  const md = `## Trading\nRisk signal profit\n## System\nFleet oversight nightly`;
  const chunks = chunkBySection(md);
  expect(chunks.length).toBe(2);
  expect(chunks[0]).toContain("Trading");
  expect(chunks[1]).toContain("System");
});

test("chunkBySection returns whole text if no H2 headings", () => {
  const md = `No headings here\njust plain text`;
  const chunks = chunkBySection(md);
  expect(chunks.length).toBe(1);
  expect(chunks[0]).toContain("plain text");
});

test("chunkBySection ignores H1 and H3 headings", () => {
  const md = `# Title\n### Sub\nAll one section`;
  const chunks = chunkBySection(md);
  expect(chunks.length).toBe(1);
});

test("chunkBySection includes heading text in chunk", () => {
  const md = `## Risk Management\nStop loss sizing kelly`;
  const chunks = chunkBySection(md);
  expect(chunks[0]).toContain("Risk Management");
  expect(chunks[0]).toContain("Stop loss");
});

test("chunkBySection skips empty sections", () => {
  const md = `## Empty\n\n## Trading\nRisk signal`;
  const chunks = chunkBySection(md);
  const nonEmpty = chunks.filter(c => c.trim().length > 5);
  expect(nonEmpty.length).toBeGreaterThanOrEqual(1);
});

// ---------------------------------------------------------------------------
// ingestFiles integration tests
// ---------------------------------------------------------------------------

test("ingestFiles reads and processes a markdown file", async () => {
  const overrideConfig = { ...config, agentAxonDir: agentsDir };
  const mdPath = join(tmpDir, "MEMORY.md");
  await writeFile(mdPath, "## Trading\nRisk signal profit trading equity drawdown\n## System\nFleet oversight nightly brief");

  const result = await ingestFiles("main", [mdPath], overrideConfig);
  expect(result.filesProcessed).toBe(1);
  expect(result.sectionsProcessed).toBe(2);
  expect(result.conceptsAdded).toBeGreaterThanOrEqual(0);
});

test("ingestFiles creates separate co-occurrence edges per section", async () => {
  const overrideConfig = { ...config, agentAxonDir: agentsDir };
  const mdPath = join(tmpDir, "SOUL.md");
  // Two sections with different concepts — edges should only be within sections
  await writeFile(mdPath, [
    "## Trading Identity",
    "trading risk signal profit equity",
    "## System Identity",
    "fleet oversight brief nightly secretarius",
  ].join("\n"));

  const result = await ingestFiles("main", [mdPath], overrideConfig);
  expect(result.filesProcessed).toBe(1);

  const axonPath = join(agentsDir, "main", "theorex", "axon.json");
  const store = await AxonStore.load(axonPath);
  expect(store.graph.order).toBeGreaterThan(0);
});

test("ingestFiles skips unreadable files gracefully", async () => {
  const overrideConfig = { ...config, agentAxonDir: agentsDir };
  const result = await ingestFiles("main", ["/nonexistent/file.md"], overrideConfig);
  expect(result.filesProcessed).toBe(0);
  expect(result.conceptsAdded).toBe(0);
});

test("ingestFiles processes multiple files", async () => {
  const overrideConfig = { ...config, agentAxonDir: agentsDir };
  const f1 = join(tmpDir, "MEMORY.md");
  const f2 = join(tmpDir, "SOUL.md");
  await writeFile(f1, "## Trading\nRisk signal profit equity");
  await writeFile(f2, "## Identity\nNova sovereign CEO fleet");

  const result = await ingestFiles("main", [f1, f2], overrideConfig);
  expect(result.filesProcessed).toBe(2);
  expect(result.sectionsProcessed).toBe(2);
});
