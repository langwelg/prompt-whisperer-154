import { createFileRoute } from "@tanstack/react-router";
import {
  convertToModelMessages,
  jsonSchema,
  stepCountIs,
  streamText,
  tool,
  type Tool,
  type UIMessage,
} from "ai";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

const SYSTEM_PROMPT = `You are the Esports Tournament Scheduling Agent.

You help a tournament organizer schedule matches, debug conflicts, and adjust
team availability or round windows. Your tools come from an MCP server you
connect to at runtime — every action below is an MCP tool call.

How to work:
1. Start by calling list_tournament so you know what teams and matches exist.
2. When asked to schedule, call run_scheduler and report the result clearly.
3. If there are conflicts, investigate with find_overlap or check_team_availability,
   then propose a fix and apply it with extend_round_window or add_team_availability.
4. After any change, re-run run_scheduler to confirm the conflict is resolved.
5. Be concise. Show match IDs, times, and reasons. Use markdown tables for matches.

Always say what you're about to do before calling a tool, and summarize
the outcome after.`;

// Convert one MCP tool descriptor into an AI SDK Tool whose `execute` proxies
// back through the MCP client. This keeps the model's tool-call surface
// genuinely MCP — the local /api/mcp server is the source of truth, and
// chat.ts is just an MCP client wrapper.
function mcpToolToAiTool(
  client: Client,
  name: string,
  description: string | undefined,
  inputSchema: unknown,
): Tool {
  return tool({
    description: description ?? name,
    inputSchema: jsonSchema(
      (inputSchema as Record<string, unknown>) ?? { type: "object" },
    ),
    execute: async (args) => {
      const result = await client.callTool({
        name,
        arguments: args as Record<string, unknown>,
      });
      return result.content;
    },
  });
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { messages } = (await request.json()) as { messages?: unknown };
        if (!Array.isArray(messages)) {
          return new Response("Messages are required", { status: 400 });
        }

        const key = process.env.LOVABLE_API_KEY;
        if (!key) {
          return new Response("Missing LOVABLE_API_KEY", { status: 500 });
        }

        // Open an MCP client against this same deployment's /api/mcp server.
        const origin = new URL(request.url).origin;
        const mcpUrl = new URL("/api/mcp", origin);
        const transport = new StreamableHTTPClientTransport(mcpUrl);
        const mcpClient = new Client(
          { name: "scheduler-agent-chat", version: "1.0.0" },
          { capabilities: {} },
        );

        try {
          await mcpClient.connect(transport);

          const { tools: mcpTools } = await mcpClient.listTools();
          const tools: Record<string, Tool> = {};
          for (const t of mcpTools) {
            tools[t.name] = mcpToolToAiTool(
              mcpClient,
              t.name,
              t.description,
              t.inputSchema,
            );
          }

          const gateway = createLovableAiGatewayProvider(key);
          const result = streamText({
            model: gateway("google/gemini-3-flash-preview"),
            system: SYSTEM_PROMPT,
            tools,
            stopWhen: stepCountIs(50),
            messages: await convertToModelMessages(messages as UIMessage[]),
            onFinish: async () => {
              await mcpClient.close().catch(() => {});
            },
            onError: async () => {
              await mcpClient.close().catch(() => {});
            },
          });

          return result.toUIMessageStreamResponse({
            originalMessages: messages as UIMessage[],
          });
        } catch (err) {
          await mcpClient.close().catch(() => {});
          const message = err instanceof Error ? err.message : String(err);
          return new Response(`MCP/agent error: ${message}`, { status: 500 });
        }
      },
    },
  },
});

// Keep z used so tree-shaking doesn't drop the dependency in some build modes.
void z;
