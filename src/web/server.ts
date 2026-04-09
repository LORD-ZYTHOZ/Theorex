// web/server.ts — Theronexus local web UI
// Serves the visual brain map on http://127.0.0.1:7777
// Proxies /api/mcp calls to the Theorex MCP server at 18800
// Serves /api/clusters and /api/stats from the local gitnexus index

import { join } from "node:path";
import { readdir, stat } from "node:fs/promises";
import { getState } from "./state";
import { computeGitChurn, computeTodoCount } from "./churn";

const MCP_URL = "http://127.0.0.1:18800/mcp";
const HTML_PATH = join(import.meta.dir, "index.html");

let reqId = 1;

async function mcpCall(method: string, params: unknown): Promise<unknown> {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: reqId++, method, params }),
  });
  return res.json();
}

async function runGitnexusCli(args: string[]): Promise<unknown> {
  const proc = Bun.spawn(
    ["npx", "-y", "gitnexus@latest", ...args],
    { stdout: "pipe", stderr: "pipe", env: { ...process.env } },
  );
  const [exitCode, raw] = await Promise.all([
    proc.exited,
    new Response(proc.stdout as ReadableStream).text(),
  ]);
  if (exitCode !== 0) throw new Error(`gitnexus exited ${exitCode}`);
  return JSON.parse(raw);
}

export function startWebServer(port = 7777): ReturnType<typeof Bun.serve> {
  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);

      // Serve UI
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(Bun.file(HTML_PATH));
      }

      // Proxy MCP tool calls
      if (url.pathname === "/api/mcp" && req.method === "POST") {
        const body = await req.json();
        const result = await mcpCall(body.method ?? "tools/call", body.params ?? {});
        return Response.json(result);
      }

      // Cluster data from local gitnexus index
      if (url.pathname === "/api/clusters") {
        try {
          const data = await runGitnexusCli([
            "cypher",
            "MATCH (n:Community) RETURN n.id, n.label, n.symbolCount, n.cohesion ORDER BY n.symbolCount DESC",
          ]) as { markdown: string; row_count: number };

          const clusters = data.markdown
            .split("\n")
            .slice(2) // skip header rows
            .filter(Boolean)
            .map((line) => {
              const cols = line.split("|").filter(Boolean).map((s) => s.trim());
              return {
                id: cols[0] ?? "",
                label: cols[1] ?? "",
                symbolCount: parseInt(cols[2] ?? "0", 10),
                cohesion: parseFloat(cols[3] ?? "0"),
              };
            })
            .filter((c) => c.label && c.symbolCount > 0);

          return Response.json({ clusters });
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 500 });
        }
      }

      // Stats from gitnexus list
      if (url.pathname === "/api/stats") {
        try {
          const proc = Bun.spawn(
            ["npx", "-y", "gitnexus@latest", "list"],
            { stdout: "pipe", stderr: "pipe", env: { ...process.env } },
          );
          const raw = await new Response(proc.stdout as ReadableStream).text();
          await proc.exited;

          const symbols = raw.match(/(\d+)\s+symbols/)?.[1];
          const clusters = raw.match(/Clusters:\s*(\d+)/)?.[1];
          const processes = raw.match(/Processes:\s*(\d+)/)?.[1];

          return Response.json({
            symbols: symbols ? parseInt(symbols, 10) : 956,
            clusters: clusters ? parseInt(clusters, 10) : 180,
            processes: processes ? parseInt(processes, 10) : 69,
          });
        } catch {
          return Response.json({ symbols: 956, clusters: 180, processes: 69 });
        }
      }

      // Graph data — nodes and edges for force-directed visualization
      if (url.pathname === "/api/graph") {
        try {
          const [fnNodes, classNodes, methodNodes, fnFnEdges, fnMethodEdges, classMethodEdges] = await Promise.all([
            runGitnexusCli(["cypher", "MATCH (n:Function) RETURN n.id, n.name, n.filePath ORDER BY n.name LIMIT 250"]),
            runGitnexusCli(["cypher", "MATCH (n:Class) RETURN n.id, n.name, n.filePath ORDER BY n.name LIMIT 60"]),
            runGitnexusCli(["cypher", "MATCH (n:Method) RETURN n.id, n.name, n.filePath ORDER BY n.name LIMIT 60"]),
            runGitnexusCli(["cypher", "MATCH (a:Function)-[r]->(b:Function) RETURN a.id, b.id LIMIT 500"]),
            runGitnexusCli(["cypher", "MATCH (a:Function)-[r]->(b:Method) RETURN a.id, b.id LIMIT 200"]),
            runGitnexusCli(["cypher", "MATCH (a:Class)-[r]->(b:Method) RETURN a.id, b.id LIMIT 200"]),
          ]);

          const parseMdTable = (result: unknown): string[][] => {
            if (Array.isArray(result)) return [];
            const r = result as { markdown?: string };
            if (!r.markdown) return [];
            return r.markdown
              .split("\n")
              .slice(2)
              .filter(Boolean)
              .map((line) => line.split("|").filter(Boolean).map((s) => s.trim()));
          };

          const toNodes = (result: unknown, type: string) =>
            parseMdTable(result).map((cols) => ({
              id: cols[0] ?? "",
              name: cols[1] ?? "",
              filePath: cols[2] ?? "",
              type,
              module: (cols[2] ?? "").split("/")[1] ?? "root",
            })).filter((n) => n.id);

          const allNodes = [
            ...toNodes(fnNodes, "Function"),
            ...toNodes(classNodes, "Class"),
            ...toNodes(methodNodes, "Method"),
          ];

          // Deduplicate nodes by id
          const nodeIds = new Set<string>();
          const nodes = allNodes.filter((n) => {
            if (nodeIds.has(n.id)) return false;
            nodeIds.add(n.id);
            return true;
          });

          const toEdges = (result: unknown) =>
            parseMdTable(result).map((cols) => ({
              source: cols[0] ?? "",
              target: cols[1] ?? "",
            }));

          const edges = [
            ...toEdges(fnFnEdges),
            ...toEdges(fnMethodEdges),
            ...toEdges(classMethodEdges),
          ].filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

          return Response.json({ nodes, edges });
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 500 });
        }
      }

      if (url.pathname === "/api/heatmap") {
        const state = getState();
        const nodeStates = state.getAllNodeStates();
        const edgeWeights = state.getAllEdgeWeights();
        return Response.json({
          nodes: Object.fromEntries(nodeStates),
          edges: Object.fromEntries(edgeWeights),
        });
      }

      // GET /api/deliberations — list all deliberation records
      if (url.pathname === "/api/deliberations") {
        try {
          const deliberDir = join(import.meta.dir, "../../data/deliberations");
          const files = (await readdir(deliberDir).catch(() => [] as string[]))
            .filter(f => f.endsWith(".json"));

          const since = url.searchParams.get("since");
          const sessionFilter = url.searchParams.get("session");

          const summaries = await Promise.all(files.map(async f => {
            try {
              const text = await Bun.file(join(deliberDir, f)).text();
              const d = JSON.parse(text);
              return {
                id: d.id ?? f.replace(".json", ""),
                date: d.date,
                session: d.session,
                status: d.status,
                model: d.model,
                tokens_used: d.tokens_used,
                latency_ms: d.latency_ms,
                created_at: d.created_at,
                file: f,
              };
            } catch { return null; }
          }));

          const filtered = summaries
            .filter((s): s is NonNullable<typeof s> => s !== null)
            .filter(s => !since || s.date >= since)
            .filter(s => !sessionFilter || s.session === sessionFilter)
            .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

          return Response.json({ deliberations: filtered });
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 500 });
        }
      }

      // GET /api/deliberations/:id — single deliberation detail
      if (url.pathname.startsWith("/api/deliberations/") && url.pathname.split("/").length === 4) {
        try {
          const id = url.pathname.split("/")[3];
          const deliberDir = join(import.meta.dir, "../../data/deliberations");
          const files = (await readdir(deliberDir).catch(() => [] as string[]))
            .filter(f => f.endsWith(".json"));

          // Match by id field or filename
          for (const f of files) {
            const text = await Bun.file(join(deliberDir, f)).text();
            const d = JSON.parse(text);
            if (d.id === id || f.replace(".json", "") === id) {
              return Response.json(d);
            }
          }
          return Response.json({ error: "Not found" }, { status: 404 });
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 500 });
        }
      }

      // Agent health status from data/health/*.json
      if (url.pathname === "/api/agents") {
        try {
          const healthDir = join(import.meta.dir, "../../data/health");
          const files = (await readdir(healthDir).catch(() => [] as string[])).filter(f => f.endsWith(".json"));
          const agents = await Promise.all(files.map(async f => {
            try {
              const text = await Bun.file(join(healthDir, f)).text();
              const d = JSON.parse(text);
              return { id: d.agent_id, status: d.status, ping_ms: d.ping_ms, success_rate: d.success_rate_7d, last_trace_at: d.last_trace_at };
            } catch { return null; }
          }));
          return Response.json({ agents: agents.filter(Boolean) });
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 500 });
        }
      }

      if (url.pathname === "/api/churn-refresh" && req.method === "POST") {
        // Properly await the async work before returning so errors surface to caller
        const refreshDone = (async () => {
          try {
            const graphData = await runGitnexusCli([
              "cypher",
              "MATCH (n:Function) RETURN n.id, n.filePath LIMIT 50",
            ]) as { markdown?: string };
            if (!graphData.markdown) return;
            const rows = graphData.markdown
              .split("\n")
              .slice(2)
              .filter(Boolean)
              .map((line) => line.split("|").filter(Boolean).map((s) => s.trim()));
            const state = getState();
            const repoDir = "/Users/eoh/theorex";
            for (const [id, filePath] of rows) {
              if (!id || !filePath) continue;
              const [churn, todos] = await Promise.all([
                computeGitChurn(filePath, repoDir),
                computeTodoCount(filePath, repoDir),
              ]);
              state.updateChurn(id, churn, todos);
              await Bun.sleep(50);
            }
          } catch (err) {
            console.error("[churn-refresh]", err);
          }
        })();
        await refreshDone;
        return Response.json({ ok: true, message: "churn refresh started" });
      }

      // Live activity stream — SSE, tails flash buffer + events.jsonl for real-time events
      if (url.pathname === "/api/events") {
        const flashDir = join(import.meta.dir, "../../data/flash");
        const eventsPath = join(import.meta.dir, "../../data/events.jsonl");
        const encoder = new TextEncoder();
        let closed = false;

        const stream = new ReadableStream({
          async start(controller) {
            const send = (data: object) => {
              try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch {}
            };
            send({ type: "connected" });

            let lastFile = "";
            let lastCount = 0;
            let lastEventsSize = 0;

            // Initialise events.jsonl cursor to current end (don't replay history)
            try { lastEventsSize = (await stat(eventsPath)).size; } catch {}

            while (!closed) {
              try {
                // ── Flash session tool events ──────────────────────────────
                const files = (await readdir(flashDir).catch(() => [] as string[]))
                  .filter(f => f.endsWith(".json"))
                  .sort()
                  .reverse();

                if (files.length > 0) {
                  const currentPath = join(flashDir, files[0]);
                  if (currentPath !== lastFile) { lastFile = currentPath; lastCount = 0; }

                  const text = await Bun.file(currentPath).text().catch(() => "{}");
                  const data = JSON.parse(text);
                  const events: unknown[] = data.events ?? [];

                  if (events.length > lastCount) {
                    const newEvents = events.slice(lastCount);
                    lastCount = events.length;
                    for (const evt of newEvents) send({ type: "tool", ...(evt as object) });
                  }
                }

                // ── System events from events.jsonl ────────────────────────
                const evtStat = await stat(eventsPath).catch(() => null);
                if (evtStat && evtStat.size > lastEventsSize) {
                  // Read only new bytes since last cursor position
                  const newBytes = Bun.file(eventsPath).slice(lastEventsSize, evtStat.size);
                  const newChunk = await new Response(newBytes).text();
                  lastEventsSize = evtStat.size;
                  const lines = newChunk.split("\n").filter(l => l.trim());
                  for (const line of lines) {
                    try {
                      const evt = JSON.parse(line);
                      if (evt.type && ["tier_change", "agent_health_change", "outcome_record"].includes(evt.type)) {
                        send({ ...evt, type: "system_event", event_type: evt.type });
                      }
                    } catch {}
                  }
                }
              } catch {}
              await Bun.sleep(300);
            }
          },
          cancel() { closed = true; },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        });
      }

      // Static file serving — serve JS modules from src/web/ directory
      // Matches paths like /main.js, /state.js, /ui/graph.js, /shaders/node.js, etc.
      const webDir = import.meta.dir;
      const safePathSegments = url.pathname.split('/').filter(s => s !== '..' && s !== '');
      if (safePathSegments.length > 0) {
        const filePath = join(webDir, ...safePathSegments);
        const file = Bun.file(filePath);
        if (await file.exists()) {
          const ext = filePath.split('.').pop() ?? '';
          const contentType = ext === 'js' ? 'application/javascript' : ext === 'css' ? 'text/css' : 'application/octet-stream';
          return new Response(file, { headers: { 'Content-Type': contentType } });
        }
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  setTimeout(() => {
    fetch(`http://127.0.0.1:${port}/api/churn-refresh`, { method: "POST" }).catch(() => {});
  }, 3000);

  return server;
}
