// serve-mcp.ts — Start Theorex MCP HTTP server for fleet access
import { startMcpServer } from "./src/mcp/server";

const server = startMcpServer({ port: 18800, host: "0.0.0.0" });
console.log(`Theorex MCP listening on http://0.0.0.0:${server.port}`);
