# Project 3 — Esports Tournament Scheduling Agent (MCP)

**Deployed app:** https://prompt-whisperer-154.lovable.app (agent at `/agent`)
**MCP endpoint:** https://prompt-whisperer-154.lovable.app/api/public/mcp
**Repository:** https://github.com/langwelg/prompt-whisperer-154

---

## 1. What the app does

A tournament organizer asks in chat: *"schedule everything and fix any
conflicts."* An LLM connects to an MCP server I wrote, discovers 6
scheduling tools, and autonomously reads the dataset, runs the scheduler,
investigates conflicts, mutates availability or round windows, and re-runs
until the bracket is clean.

- **`/`** redirects to **`/agent`** — the agent chat is the primary UI.
- The deterministic scheduler in `src/lib/scheduler.ts` is exercised by
  the agent through the `run_scheduler` MCP tool; its output is rendered
  inside the chat as expandable AI Elements tool cards.

**Who it's for:** small-tournament organizers (campus esports clubs,
weekend LAN events) who today juggle availability in spreadsheets.

## 2. System architecture

```
Browser ── /agent (TanStack Start route)
   │      useChat + DefaultChatTransport → POST /api/chat
   ▼
Chat server route  src/routes/api/chat.ts
   │  1. opens an MCP client (StreamableHTTPClientTransport)
   │     to /api/public/mcp on the same deployment
   │  2. calls mcpClient.listTools() and wraps each MCP tool as an
   │     AI SDK Tool whose execute() proxies to mcpClient.callTool()
   │  3. streamText({ model, tools, stopWhen: stepCountIs(50) })
   ▼
Lovable AI Gateway → google/gemini-3-flash-preview
                       │
                       ▼  (the model picks tools and arguments)
MCP server route  src/routes/api/public/mcp.ts
   │  mcp-tanstack-start + @modelcontextprotocol/sdk
   │  6 tools defined in src/lib/mcp/tools/scheduler.ts
   ▼
Shared executor  src/lib/scheduler-state.server.ts
   │  in-memory tournament state + pure functions
   ▼
Deterministic scheduler  src/lib/scheduler.ts
```

- **Frontend:** TanStack Start + React, AI Elements (`Conversation`,
  `Message`, `Tool`, `PromptInput`) so each MCP tool call renders as an
  expandable card with parameters and result JSON.
- **AI Gateway:** `@ai-sdk/openai-compatible` pointed at
  `https://ai.gateway.lovable.dev/v1`, `LOVABLE_API_KEY` injected
  server-side only.
- **Agent loop:** `streamText` with `stopWhen: stepCountIs(50)` — the
  model can chain up to 50 tool calls in one turn before stopping.

## 3. The MCP server I built

`src/routes/api/public/mcp.ts` runs an MCP Streamable HTTP server
(`mcp-tanstack-start`, `@modelcontextprotocol/sdk`). It is at
`/api/public/mcp` so external callers (Claude Desktop, Cursor,
`mcp-inspector`) and the in-app agent can both hit it without an auth wall.

6 tools, all defined in `src/lib/mcp/tools/scheduler.ts`:

| Tool                       | Type  | Input (Zod)                                                 |
| -------------------------- | ----- | ----------------------------------------------------------- |
| `list_tournament`          | read  | `{}`                                                        |
| `check_team_availability`  | read  | `{ team: string }`                                          |
| `find_overlap`             | read  | `{ teamA: string, teamB: string }`                          |
| `run_scheduler`            | read  | `{}`                                                        |
| `extend_round_window`      | write | `{ round: enum["QF","SF","F"], extraMinutes: int 15..720 }` |
| `add_team_availability`    | write | `{ team: string, start: iso, end: iso }`                    |

Tighter schemas vs. the P2 draft:
- `round` is now `z.enum(["QF","SF","F"])` — the model used to hallucinate
  codes like `"SF2"`; the enum rejects them at the tool boundary before any
  execution.
- `start` / `end` use a regex that requires ISO 8601 UTC (`...Z`), and the
  executor rejects `end <= start`.
- `extraMinutes` is bounded `15..720` so the agent can't accidentally extend
  a round by years.
- All `team` fields are `min(1)`. Unknown teams come back with a
  `knownTeams: [...]` hint so the model can self-correct on the next step.

To test the MCP server directly:

```bash
curl -X POST https://prompt-whisperer-154.lovable.app/api/public/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## 4. Agentic patterns

1. **MCP tool use** — the chat handler is an MCP *client*; the model's
   entire action surface comes from `mcpClient.listTools()`. There is no
   hardcoded list of tools in the chat route.
2. **Multi-step loop** — `stopWhen: stepCountIs(50)` lets the model call
   `list_tournament → run_scheduler → find_overlap → extend_round_window →
   run_scheduler` in one user turn.
3. **Plan-act-verify prompting** — the system prompt requires the model to
   announce the plan, call the tool, then summarize and re-verify after any
   write.
4. **Self-correction from tool errors** — when Zod rejects an input or a
   tool returns `{ error, knownTeams }`, the model sees the validation error
   in the same conversation and adapts in the next step.

## 5. What the model decides vs. what's hard-coded

| Decision                            | Where         |
| ----------------------------------- | ------------- |
| Which tool to call next             | **Model**     |
| What arguments to pass              | **Model**     |
| Whether a conflict needs more data  | **Model**     |
| Which round to extend / by how much | **Model**     |
| Whether to re-run after a fix       | **Model**     |
| The actual slot-placement math      | Code (`schedule()` in `src/lib/scheduler.ts`) |
| Input validation                    | Code (Zod schemas) |
| Step cap                            | Code (`stepCountIs(50)`) |

## 6. Iteration from P2 draft feedback

P2 draft feedback was: no GitHub repo, no write-up, agentic behavior not
verifiable. P3 changes:

- **Repo public** at https://github.com/langwelg/prompt-whisperer-154.
- **Real MCP server** I authored — P2 used inline AI SDK function tools
  only; the model now genuinely calls MCP tools over HTTP.
- **Tighter schemas** — `round` enum, ISO regex, bounds on `extraMinutes`,
  validated team names with hint-on-failure.
- **`/api/public/mcp` placement** so external MCP clients can connect
  without the preview auth wall.
- **AI Elements tool cards** in `/agent` show every tool call's input and
  output, so anyone reviewing the app can see the agent's actual decisions.

## 7. Where it breaks (known limitations)

- **In-memory state** — tournament data lives in a module-level object and
  resets on every server cold start. Multi-user sessions share one dataset.
- **No approval gate on writes** — `extend_round_window` and
  `add_team_availability` execute immediately. A `needsApproval` step is the
  next obvious upgrade.
- **No retries on 429s** from the AI Gateway.
- **MCP client is re-opened per request** — fine for low traffic, would be
  worth pooling under load.

## 8. AI directed (how I built it)

Built in Lovable, primarily using Claude. I directed it to:
1. Start from a deterministic scheduler so the tools have something real to
   call.
2. Define each tool as a narrow single-purpose function with a Zod schema
   instead of one "do everything" tool.
3. Use `streamText` + `stopWhen: stepCountIs(50)` and AI Elements for tool
   visibility so the agent's reasoning is auditable.
4. For P3: extract the in-memory state and executors into
   `scheduler-state.server.ts`, stand up an MCP server at
   `/api/public/mcp` with `mcp-tanstack-start` + `@modelcontextprotocol/sdk`,
   rewrite the chat route as an MCP client, and tighten schemas.

## 9. Key files

- `src/routes/api/public/mcp.ts` — MCP server (Streamable HTTP)
- `src/lib/mcp/tools/scheduler.ts` — 6 MCP tool definitions
- `src/lib/scheduler-state.server.ts` — shared state + executors
- `src/lib/scheduler.ts` — deterministic scheduling math
- `src/routes/api/chat.ts` — MCP client + LLM loop
- `src/routes/agent.tsx` — chat UI with AI Elements tool cards
- `src/routes/index.tsx` — redirects `/` to `/agent`
- `src/routes/scheduler.tsx` — deterministic scheduler debug view

## 10. Prompt engineering history

The system prompt in `src/routes/api/chat.ts` went through three revisions.
Each one was driven by a failure I saw in actual chats.

**v1 (P2 draft) — too terse, model skipped tools:**
```
You are a scheduling assistant. Use the tools to help the user schedule
esports matches.
```
*Failure:* Model would answer from the empty conversation without ever
calling `list_tournament`, hallucinating team names like "Team A / Team B."

**v2 — added an explicit ordering, but rigid:**
```
You are the scheduling agent. ALWAYS call list_tournament first, then
run_scheduler, then report results.
```
*Failure:* Model robotically called those two tools even when the user
asked something narrow like *"is Team Phoenix free Saturday?"* — wasted
steps, and it never used `check_team_availability` or `find_overlap`.

**v3 (current) — plan-act-verify with conditional tool guidance:**
```
1. Start by calling list_tournament so you know what teams and matches exist.
2. When asked to schedule, call run_scheduler and report the result clearly.
3. If there are conflicts, investigate with find_overlap or
   check_team_availability, then propose a fix and apply it with
   extend_round_window or add_team_availability.
4. After any change, re-run run_scheduler to confirm the conflict is resolved.
5. Be concise. Show match IDs, times, and reasons. Use markdown tables.
Always say what you're about to do before calling a tool, and summarize
the outcome after.
```
*Why it works:* tools are described by *situation*, not by fixed order.
The "re-run after any write" rule produces the verify step that makes the
loop feel agentic instead of one-shot. The "say what you're about to do"
rule makes traces auditable in the AI Elements tool cards.

## 11. Evaluation

I ran 6 scripted prompts against the deployed agent. "Pass" = the model
reached the correct end-state autonomously, with no human follow-up.

| # | Prompt | Expected behavior | Result |
|---|--------|-------------------|--------|
| 1 | "List the tournament." | 1 tool call: `list_tournament`. | Pass |
| 2 | "Schedule everything." | `list_tournament` → `run_scheduler`, report scheduled + conflicts. | Pass |
| 3 | "Schedule and fix any conflicts." | Above + `find_overlap` / `check_team_availability` → `extend_round_window` or `add_team_availability` → `run_scheduler` again. Conflicts = 0 at end. | Pass (3–5 tool calls typical) |
| 4 | "Is Team Phoenix free Saturday afternoon?" | Single `check_team_availability` call, no full schedule run. | Pass (v2 prompt failed this; v3 fixed it) |
| 5 | "Extend SF2 by 60 minutes." | Model attempts `extend_round_window({round:"SF2",...})`, Zod enum rejects, model retries with `"SF"` based on error hint. | Pass (self-correction in 2 steps) |
| 6 | "Add availability for Team Nobody on Saturday 2pm–4pm UTC." | `add_team_availability` returns `{error, knownTeams:[...]}`; model surfaces the list to the user instead of inventing a team. | Pass |

**What "good" means here:**
- Correctness: conflicts go to 0 after the agent's fix loop (case 3).
- Restraint: agent doesn't over-call tools on narrow questions (case 4).
- Recovery: agent uses validation errors to self-correct (cases 5, 6).

**Documented failures:**
- Long sessions occasionally hit the 50-step cap when the model loops on a
  truly unschedulable match instead of reporting "no fix possible." Fix
  for next iteration: a `report_unschedulable` tool to give the model a
  clean exit.
- Cold-start state resets mean a second user can see partial mutations
  from the first. Fix: per-session state keyed by a thread id.

## 12. Reflection — what I'd do with more time

- Per-session state in a real DB (Lovable Cloud) so multiple organizers
  don't share one bracket.
- `needsApproval` on the two write tools so the user confirms mutations.
- Eval harness scripted with `mcp-inspector` so the 6 cases above run on
  every commit instead of by hand.
