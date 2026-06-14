// AI SDK tool wrappers around the shared scheduler state.
// These are the same operations exposed via MCP at /api/mcp — keeping both
// surfaces backed by src/lib/scheduler-state.server.ts means a fix in one
// place updates both the in-app agent and any external MCP client.

import { tool } from "ai";
import { z } from "zod";
import {
  ROUND_CODES,
  listTournament,
  checkTeamAvailability,
  findOverlap,
  runScheduler,
  extendRoundWindow,
  addTeamAvailability,
} from "./scheduler-state.server";

const isoTimestamp = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/,
    "Must be an ISO 8601 UTC timestamp like 2026-05-20T18:00:00Z",
  );

export const schedulerTools = {
  list_tournament: tool({
    description:
      "List all teams, matches, and round windows currently loaded in the tournament. Call this first to learn what exists.",
    inputSchema: z.object({}),
    execute: async () => listTournament(),
  }),

  check_team_availability: tool({
    description: "Get the availability windows for a single team by name.",
    inputSchema: z.object({
      team: z.string().min(1).describe("Team name, e.g. 'PhantomAces'"),
    }),
    execute: async ({ team }) => checkTeamAvailability(team),
  }),

  find_overlap: tool({
    description:
      "Find time overlap between two teams' availability. Useful to debug why a match conflicts.",
    inputSchema: z.object({
      teamA: z.string().min(1),
      teamB: z.string().min(1),
    }),
    execute: async ({ teamA, teamB }) => findOverlap(teamA, teamB),
  }),

  run_scheduler: tool({
    description:
      "Run the deterministic scheduler on the current tournament. Returns scheduled matches and conflicts.",
    inputSchema: z.object({}),
    execute: async () => runScheduler(),
  }),

  extend_round_window: tool({
    description:
      "Extend a round's time window by a number of minutes (end time only). Use to resolve conflicts.",
    inputSchema: z.object({
      round: z
        .enum(ROUND_CODES)
        .describe("Round code. Only QF, SF, or F are valid."),
      extraMinutes: z.number().int().min(15).max(720),
    }),
    execute: async ({ round, extraMinutes }) =>
      extendRoundWindow(round, extraMinutes),
  }),

  add_team_availability: tool({
    description:
      "Add a new availability window for a team (ISO timestamps). Use to fix 'no overlap' conflicts.",
    inputSchema: z.object({
      team: z.string().min(1),
      start: isoTimestamp,
      end: isoTimestamp,
    }),
    execute: async ({ team, start, end }) =>
      addTeamAvailability(team, start, end),
  }),
};

export { resetTournament } from "./scheduler-state.server";
