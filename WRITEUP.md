# Project 2 — Esports Tournament Scheduling Agent

**Deployed app:** https://prompt-whisperer-154.lovable.app (agent at `/agent`)
**Repository:** https://github.com/langwelg/prompt-whisperer-154

---

## 1. What the app does

Two modes share one tournament dataset (teams, matches, round windows):

- **Deterministic scheduler** (`/`) — a pure function in `src/lib/scheduler.ts`
  that places each match inside its round window using the intersection of
  both teams' availability. Returns either a `scheduled` slot or a `conflict`
  with a reason (`no overlap`, `outside round window`, etc.).
- **Agent** (`/agent`) — a chat UI backed by an LLM that can call tools to
  read and mutate the same dataset, then re-run the scheduler.

## 2. System architecture

```
Browser  ── /agent (TanStack Start route, src/routes/agent.tsx)
   │        useChat + DefaultChatTransport → POST /api/chat
   ▼
Server route  src/routes/api/chat.ts
   │   streamText({ model, tools, stopWhen: stepCountIs(50) })
   ▼
Lovable AI Gateway  →  google/gemini-3-flash-preview
   │
   ▼
Tools (src/lib/scheduler-tools.ts, Zod-validated)
   │   read/write a module-level tournament state object
   ▼
Deterministic scheduler (src/lib/scheduler.ts)
```

- **Frontend:** TanStack Start + React, AI Elements (`Conversation`,
  `Message`, `Tool`, `PromptInput`) so tool calls render as expandable
  cards showing JSON input and output.
- **Backend:** TanStack Start server route at `src/routes/api/chat.ts`
  using `streamText` from the Vercel AI SDK and the Lovable AI Gateway
  provider (`src/lib/ai-gateway.server.ts`). `LOVABLE_API_KEY` stays
  server-side.
- **State:** in-memory object in `scheduler-tools.ts`. Resets on server
  restart — intentional for a demo, called out as a limitation below.

## 3. Agentic patterns implemented

- **Tool use with a typed contract.** Six AI SDK `tool()` definitions, each
  with a narrow Zod `inputSchema` so the model can't pass malformed args.
- **Multi-step autonomous loop.** `stopWhen: stepCountIs(50)` lets the SDK
  drive a model→tool→model→tool cycle until the model produces a final
  text answer or hits the cap.
- **Plan → act → verify.** The system prompt requires the model to start
  with `list_tournament`, then act, then re-run `run_scheduler` to confirm
  any fix actually resolved the conflict.
- **Self-correction from tool errors.** Zod validation failures are returned
  to the loop as errors; the model retries with corrected arguments.
- **Read/write separation surfaced in UI.** Every tool call is expandable in
  the transcript so the grader can see exactly which tools fired, in what
  order, with what arguments and results.

### Tools

| Tool | R/W | Purpose |
|---|---|---|
| `list_tournament` | R | Dump teams, matches, round windows |
| `check_team_availability` | R | One team's availability |
| `find_overlap` | R | Intersect two teams' windows (debug "no overlap") |
| `run_scheduler` | R | Run deterministic scheduler, return scheduled + conflicts |
| `extend_round_window` | **W** | Push a round's end time out by N minutes |
| `add_team_availability` | **W** | Add an ISO availability window to a team |

### What the model decides vs. what's hard-coded

- **Hard-coded:** placement math, overlap math, conflict reasons, Zod
  input validation, the 50-step cap.
- **Model decides:** which tool to call, in what order, with what arguments,
  and whether a given conflict is better fixed by extending a window or
  adding availability.

## 4. How I iterated on draft feedback

Professor's draft feedback flagged three things: **no repo, no write-up, no
way to verify agentic behavior.** Changes for the final:

1. **Pushed to GitHub** via Lovable's GitHub integration so the code is
   inspectable (link at the top).
2. **Added this write-up** at `WRITEUP.md` in the repo root, covering
   tools, decisions, and failure modes — the things the rubric asks for.
3. **Made agentic behavior verifiable in the UI.** The AI Elements `Tool`
   component renders every tool call as an expandable card showing the
   exact JSON arguments and the tool's return value, so a grader can
   confirm tools are actually firing and not just narrated in prose.
4. **Tightened tool boundaries** after watching the model conflate
   capabilities in the draft — split `find_overlap` out from
   `check_team_availability` so each tool does one thing.
5. **Wrote a "where it breaks" section** (below) so limitations are
   documented instead of discovered.

## 5. Where it breaks (known limitations)

- **State is in memory** and resets on server restart.
- **No approval gate on writes.** `extend_round_window` and
  `add_team_availability` execute as soon as the model calls them. Should
  be wrapped in `needsApproval` for production.
- **Round-code hallucination.** The model occasionally invents a round
  code; Zod rejects it and the loop self-corrects, but a stricter enum on
  `round` would catch it at the schema.
- **No retry/backoff** on gateway 429/credit errors — the error surfaces
  to the UI but the agent doesn't recover.
- **One conversation, no persistence** (chosen during draft scoping).

## 6. How to verify the agentic behavior

1. Open `/agent`.
2. Send: **"Schedule the tournament."** → expect `list_tournament` →
   `run_scheduler`, then a summary with conflicts.
3. Send: **"Why does QF2 conflict, and can you fix it?"** → expect
   `find_overlap` or `check_team_availability` → `extend_round_window`
   or `add_team_availability` → `run_scheduler` again → confirmation.
4. Expand any tool card in the transcript to see the JSON args and result.

## 7. AI I directed

Built in Lovable (Claude under the hood). I directed it to:

1. Write the deterministic scheduler first so the agent had real logic
   to call.
2. Wrap each capability as a single-purpose `tool()` with a narrow Zod
   schema — not one "do everything" tool.
3. Wire `streamText` + `stepCountIs(50)` in a TanStack Start server route.
4. Render tool calls with AI Elements so JSON inputs/outputs are visible.

I wrote the system prompt, picked the tool boundaries, and chose the
model (Gemini 3 Flash via Lovable AI Gateway).

## 8. Key files

- `src/lib/scheduler.ts` — deterministic scheduler
- `src/lib/scheduler-tools.ts` — tool definitions + in-memory state
- `src/routes/api/chat.ts` — `streamText` agent loop
- `src/routes/agent.tsx` — chat UI
- `src/lib/ai-gateway.server.ts` — Lovable AI Gateway provider
