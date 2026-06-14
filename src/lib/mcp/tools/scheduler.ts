// MCP tool definitions for the scheduling agent.
// These wrap the same shared executor functions as the in-app AI SDK tools,
// so an external MCP client (Claude Desktop, Cursor, the in-app agent) gets
// the same behavior as the chat UI.

import { defineTool } from "mcp-tanstack-start";
import { z } from "zod";
import {
  ROUND_CODES,
  listTournament,
  checkTeamAvailability,
  findOverlap,
  runScheduler,
  extendRoundWindow,
  addTeamAvailability,
} from "@/lib/scheduler-state.server";

const isoTimestamp = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/,
    "Must be an ISO 8601 UTC timestamp like 2026-05-20T18:00:00Z",
  );

const json = (value: unknown) => JSON.stringify(value, null, 2);

export const listTournamentTool = defineTool({
  name: "list_tournament",
  description:
    "List teams, matches, and round windows currently loaded in the tournament.",
  parameters: z.object({}),
  execute: async () => json(listTournament()),
});

export const checkTeamAvailabilityTool = defineTool({
  name: "check_team_availability",
  description: "Get availability windows for a single team by name.",
  parameters: z.object({
    team: z.string().min(1).describe("Team name, e.g. 'PhantomAces'"),
  }),
  execute: async ({ team }) => json(checkTeamAvailability(team)),
});

export const findOverlapTool = defineTool({
  name: "find_overlap",
  description:
    "Find time overlap between two teams' availability — useful for debugging conflicts.",
  parameters: z.object({
    teamA: z.string().min(1),
    teamB: z.string().min(1),
  }),
  execute: async ({ teamA, teamB }) => json(findOverlap(teamA, teamB)),
});

export const runSchedulerTool = defineTool({
  name: "run_scheduler",
  description:
    "Run the deterministic scheduler on the current tournament and return scheduled matches and conflicts.",
  parameters: z.object({}),
  execute: async () => json(runScheduler()),
});

export const extendRoundWindowTool = defineTool({
  name: "extend_round_window",
  description:
    "Extend a round's end time by N minutes. Use to resolve round-window conflicts.",
  parameters: z.object({
    round: z
      .enum(ROUND_CODES)
      .describe("Round code. Only QF, SF, or F are valid."),
    extraMinutes: z.number().int().min(15).max(720),
  }),
  execute: async ({ round, extraMinutes }) =>
    json(extendRoundWindow(round, extraMinutes)),
});

export const addTeamAvailabilityTool = defineTool({
  name: "add_team_availability",
  description:
    "Add a new availability window for a team (ISO UTC timestamps). Use to fix 'no overlap' conflicts.",
  parameters: z.object({
    team: z.string().min(1),
    start: isoTimestamp,
    end: isoTimestamp,
  }),
  execute: async ({ team, start, end }) =>
    json(addTeamAvailability(team, start, end)),
});

export const schedulerMcpTools = [
  listTournamentTool,
  checkTeamAvailabilityTool,
  findOverlapTool,
  runSchedulerTool,
  extendRoundWindowTool,
  addTeamAvailabilityTool,
];
