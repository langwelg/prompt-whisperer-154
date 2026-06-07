# Project 2 — Esports Tournament Scheduling Agent

## What the app does

Two modes share one tournament dataset (teams, matches, round windows):

1. **Deterministic scheduler** (`/`) — a pure function in `src/lib/scheduler.ts` that
   tries to place each match inside its round window using the intersection of both
   teams' availability. Returns either a `scheduled` slot or a `conflict` with a
   reason (`no overlap`, `outside round window`, etc.).
2. **Agent** (`/agent`) — a chat UI backed by an LLM that can call tools to read
   and mutate the same dataset, then re-run the scheduler.

## What happens when the agent schedules a match

The server route `src/routes/api/chat.ts` calls `streamText` from the Vercel AI
SDK with `stopWhen: stepCountIs(50)`, the system prompt, and the tool set from
`src/lib/scheduler-tools.ts`. The loop is: model emits a tool call → SDK runs
the tool's `execute` → result is appended to the message history → model decides
the next step → repeat until it produces a final text answer or hits the step
cap.

### Tools the model can call

All tools are defined with Zod input schemas in `src/lib/scheduler-tools.ts`:

| Tool | Reads / Writes | Purpose |
|---|---|---|
| `list_tournament` | read | Dump teams, matches, round windows |
| `check_team_availability` | read | Availability windows for one team |
| `find_overlap` | read | Intersect two teams' availability (debug "no overlap") |
| `run_scheduler` | read | Run the deterministic scheduler, return scheduled + conflicts |
| `extend_round_window` | **write** | Push a round's end time out by N minutes |
| `add_team_availability` | **write** | Add an ISO window to a team |

State lives in a module-level object in `scheduler-tools.ts` and resets on
server restart (intentional for the demo — no DB needed).

### What the model decides vs. what is hard-coded

- **Hard-coded:** match placement math, overlap math, what counts as a conflict,
  input validation (Zod), the 50-step cap.
- **Model decides:** which tool to call, in what order, with what arguments;
  whether a conflict is best fixed by extending a window vs. adding availability;
  how to summarize results to the user.

The system prompt tells it to always start with `list_tournament`, re-run
`run_scheduler` after any write, and report match IDs and times in markdown
tables.

### Where it breaks

- **State is in memory.** Restart the dev server and edits vanish. Fine for a
  single chat session, wrong for anything real.
- **No approval gate on writes.** `extend_round_window` and `add_team_availability`
  execute as soon as the model calls them. For production I'd wrap them with
  `needsApproval` so the organizer confirms.
- **One conversation, no persistence.** Reloading the page wipes history.
- **Model hallucination on round names.** When I asked it to "extend SF", it
  sometimes invented a round code. Zod rejects it, the error goes back into
  the loop, and it usually self-corrects on the next step — but a stricter
  enum on `round` would catch this at the schema level.
- **No retries on gateway errors.** If the Lovable AI Gateway returns a 429 or
  credit error, the stream surfaces it to the UI but the agent doesn't back off.

## How I built it (and what I directed the AI to do)

I used Lovable (which uses Claude under the hood) to scaffold and iterate.
Concretely, I directed it to:

1. Generate a deterministic scheduler first (`src/lib/scheduler.ts`) with
   sample data, so the agent had something real to call.
2. Wrap each scheduler capability as a single-purpose AI SDK `tool` with a
   Zod schema — explicitly *not* one big "do everything" tool.
3. Wire `streamText` + `stepCountIs(50)` in a TanStack Start server route at
   `src/routes/api/chat.ts`, using the Lovable AI Gateway provider with
   `google/gemini-3-flash-preview`.
4. Build the chat UI with AI Elements (`Conversation`, `Message`, `Tool`,
   `PromptInput`) so tool calls and their JSON inputs/outputs are visible in
   the transcript — that's the verifiable "agentic behavior" surface.

I wrote the system prompt and the tool descriptions myself, and I picked the
tool boundaries (e.g. splitting `find_overlap` out from `check_team_availability`
after seeing the model conflate them).

## How to verify the agentic behavior

1. Open `/agent`.
2. Send: **"Schedule the tournament."** — expect `list_tournament` →
   `run_scheduler`, then a summary with conflicts.
3. Send: **"Why does QF2 conflict, and can you fix it?"** — expect
   `find_overlap` or `check_team_availability` → `extend_round_window` or
   `add_team_availability` → `run_scheduler` again → confirmation.
4. Every tool call is expandable in the UI to show the exact JSON arguments
   and the result the tool returned.

## Key files

- `src/lib/scheduler.ts` — deterministic scheduler
- `src/lib/scheduler-tools.ts` — tool definitions + in-memory state
- `src/routes/api/chat.ts` — `streamText` agent loop
- `src/routes/agent.tsx` — chat UI
- `src/lib/ai-gateway.server.ts` — Lovable AI Gateway provider
