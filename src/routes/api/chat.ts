import { createFileRoute } from "@tanstack/react-router";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { schedulerTools } from "@/lib/scheduler-tools";

const SYSTEM_PROMPT = `You are the Esports Tournament Scheduling Agent.

You help a tournament organizer schedule matches, debug conflicts, and adjust
team availability or round windows. You have access to tools that read and
modify a live tournament dataset (teams, matches, round windows).

How to work:
1. Start by calling list_tournament so you know what teams and matches exist.
2. When asked to schedule, call run_scheduler and report the result clearly.
3. If there are conflicts, investigate with find_overlap or check_team_availability,
   then propose a fix and apply it with extend_round_window or add_team_availability.
4. After any change, re-run run_scheduler to confirm the conflict is resolved.
5. Be concise. Show match IDs, times, and reasons. Use markdown tables when listing matches.

Always explain what you're about to do before calling a tool, and summarize
the outcome after.`;

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

        const gateway = createLovableAiGatewayProvider(key);
        const result = streamText({
          model: gateway("google/gemini-3-flash-preview"),
          system: SYSTEM_PROMPT,
          tools: schedulerTools,
          stopWhen: stepCountIs(50),
          messages: await convertToModelMessages(messages as UIMessage[]),
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages as UIMessage[],
        });
      },
    },
  },
});
