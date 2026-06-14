// MCP server exposing the tournament scheduler tools.
// Streamable HTTP transport per the MCP spec — POST only. GET/DELETE return
// 405 because we do not implement standalone SSE.
//
// Anyone with an MCP client (Claude Desktop, Cursor, mcp-inspector) can point
// at this URL and drive the same scheduler the in-app agent uses.

import { createFileRoute } from "@tanstack/react-router";
import { createMcpServer } from "mcp-tanstack-start";
import { schedulerMcpTools } from "@/lib/mcp/tools/scheduler";

const mcp = createMcpServer({
  name: "esports-scheduler",
  version: "1.0.0",
  instructions:
    "Tools for scheduling esports tournament matches. Start with list_tournament to learn what teams, matches, and round windows exist. Use find_overlap and check_team_availability to debug conflicts, then extend_round_window or add_team_availability to fix them, and re-run run_scheduler to verify.",
  tools: schedulerMcpTools,
});

const methodNotAllowed = () =>
  new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    }),
    {
      status: 405,
      headers: {
        "Content-Type": "application/json",
        Allow: "POST, OPTIONS",
      },
    },
  );

export const Route = createFileRoute("/api/public/mcp")({
  server: {
    handlers: {
      POST: async ({ request }) => mcp.handleRequest(request),
      GET: async () => methodNotAllowed(),
      DELETE: async () => methodNotAllowed(),
    },
  },
});
