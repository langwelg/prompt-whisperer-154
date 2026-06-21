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
- **`/scheduler`** is a debug view of the deterministic scheduler
  (`src/lib/scheduler.ts`) for inspection; it is not the main interface.
- Both surfaces share one in-memory tournament state
  (`src/lib/scheduler-state.server.ts`), so the agent's writes are visible
  in the debug view.

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
- `src/routes/index.tsx` — deterministic scheduler UI
