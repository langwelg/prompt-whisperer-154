// Tools the scheduling agent can call. Each one wraps a small piece of
// the deterministic scheduler so the LLM can investigate and act step by step.

import { tool } from "ai";
import { z } from "zod";
import {
  schedule,
  sampleTeams,
  sampleMatches,
  sampleWindows,
  type Team,
  type Match,
  type RoundWindow,
} from "./scheduler";

// In-memory tournament state (fine for a draft demo — resets on server restart).
const state: { teams: Team[]; matches: Match[]; windows: RoundWindow[] } = {
  teams: structuredClone(sampleTeams),
  matches: structuredClone(sampleMatches),
  windows: structuredClone(sampleWindows),
};

const toMs = (s: string) => new Date(s).getTime();

export const schedulerTools = {
  list_tournament: tool({
    description:
      "List all teams, matches, and round windows currently loaded in the tournament.",
    inputSchema: z.object({}),
    execute: async () => ({
      teams: state.teams.map((t) => t.name),
      matches: state.matches.map((m) => ({
        id: m.id,
        round: m.round,
        teamA: m.teamA,
        teamB: m.teamB,
        durationMin: m.durationMin,
      })),
      windows: state.windows,
    }),
  }),

  check_team_availability: tool({
    description: "Get the availability windows for a single team by name.",
    inputSchema: z.object({
      team: z.string().describe("Team name, e.g. 'PhantomAces'"),
    }),
    execute: async ({ team }) => {
      const t = state.teams.find(
        (x) => x.name.toLowerCase() === team.toLowerCase(),
      );
      if (!t) return { error: `Team '${team}' not found.` };
      return { team: t.name, availability: t.availability };
    },
  }),

  find_overlap: tool({
    description:
      "Find time overlap between two teams' availability. Useful to debug why a match conflicts.",
    inputSchema: z.object({
      teamA: z.string(),
      teamB: z.string(),
    }),
    execute: async ({ teamA, teamB }) => {
      const a = state.teams.find((t) => t.name === teamA);
      const b = state.teams.find((t) => t.name === teamB);
      if (!a || !b) return { error: "One or both teams not found." };
      const overlaps: { start: string; end: string; durationMin: number }[] = [];
      for (const x of a.availability) {
        for (const y of b.availability) {
          const start = Math.max(toMs(x.start), toMs(y.start));
          const end = Math.min(toMs(x.end), toMs(y.end));
          if (end > start) {
            overlaps.push({
              start: new Date(start).toISOString(),
              end: new Date(end).toISOString(),
              durationMin: Math.round((end - start) / 60_000),
            });
          }
        }
      }
      return { teamA, teamB, overlaps };
    },
  }),

  run_scheduler: tool({
    description:
      "Run the deterministic scheduler on the current tournament. Returns scheduled matches and conflicts.",
    inputSchema: z.object({}),
    execute: async () => {
      const results = schedule(state.teams, state.matches, state.windows);
      return {
        total: results.length,
        scheduled: results.filter((r) => r.status === "scheduled").length,
        conflicts: results.filter((r) => r.status === "conflict").length,
        results,
      };
    },
  }),

  extend_round_window: tool({
    description:
      "Extend a round's time window by a number of minutes (end time only). Use to resolve conflicts.",
    inputSchema: z.object({
      round: z.string().describe("Round code, e.g. 'QF' or 'SF'"),
      extraMinutes: z.number().int().min(15).max(720),
    }),
    execute: async ({ round, extraMinutes }) => {
      const w = state.windows.find((r) => r.round === round);
      if (!w) return { error: `Round '${round}' not found.` };
      const newEnd = new Date(toMs(w.end) + extraMinutes * 60_000).toISOString();
      const oldEnd = w.end;
      w.end = newEnd;
      return { round, oldEnd, newEnd, extendedBy: `${extraMinutes} minutes` };
    },
  }),

  add_team_availability: tool({
    description:
      "Add a new availability window for a team (ISO timestamps). Use to fix 'no overlap' conflicts.",
    inputSchema: z.object({
      team: z.string(),
      start: z.string().describe("ISO timestamp, e.g. 2026-05-20T18:00:00Z"),
      end: z.string().describe("ISO timestamp"),
    }),
    execute: async ({ team, start, end }) => {
      const t = state.teams.find((x) => x.name === team);
      if (!t) return { error: `Team '${team}' not found.` };
      t.availability.push({ start, end });
      return { team, added: { start, end }, availability: t.availability };
    },
  }),
};

export function resetTournament() {
  state.teams = structuredClone(sampleTeams);
  state.matches = structuredClone(sampleMatches);
  state.windows = structuredClone(sampleWindows);
}
