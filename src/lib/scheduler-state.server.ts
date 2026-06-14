// Shared in-memory tournament state and pure executor functions.
// Both the AI SDK tool wrappers (src/lib/scheduler-tools.ts) and the MCP
// server tools (src/lib/mcp/tools/scheduler.ts) call into these functions
// so the two surfaces stay in lockstep.

import {
  schedule,
  sampleTeams,
  sampleMatches,
  sampleWindows,
  type Team,
  type Match,
  type RoundWindow,
} from "./scheduler";

const state: { teams: Team[]; matches: Match[]; windows: RoundWindow[] } = {
  teams: structuredClone(sampleTeams),
  matches: structuredClone(sampleMatches),
  windows: structuredClone(sampleWindows),
};

const toMs = (s: string) => new Date(s).getTime();

// Supported round codes. Kept narrow on purpose so the model cannot invent
// new round codes like "SF2" — Zod's enum validation rejects them at the
// tool boundary before any execution runs.
export const ROUND_CODES = ["QF", "SF", "F"] as const;
export type RoundCode = (typeof ROUND_CODES)[number];

export function getKnownTeamNames(): string[] {
  return state.teams.map((t) => t.name);
}

export function listTournament() {
  return {
    teams: state.teams.map((t) => t.name),
    matches: state.matches.map((m) => ({
      id: m.id,
      round: m.round,
      teamA: m.teamA,
      teamB: m.teamB,
      durationMin: m.durationMin,
    })),
    windows: state.windows,
  };
}

export function checkTeamAvailability(team: string) {
  const t = state.teams.find(
    (x) => x.name.toLowerCase() === team.toLowerCase(),
  );
  if (!t) {
    return {
      error: `Team '${team}' not found.`,
      knownTeams: getKnownTeamNames(),
    };
  }
  return { team: t.name, availability: t.availability };
}

export function findOverlap(teamA: string, teamB: string) {
  const a = state.teams.find(
    (t) => t.name.toLowerCase() === teamA.toLowerCase(),
  );
  const b = state.teams.find(
    (t) => t.name.toLowerCase() === teamB.toLowerCase(),
  );
  if (!a || !b) {
    return {
      error: "One or both teams not found.",
      knownTeams: getKnownTeamNames(),
    };
  }
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
  return { teamA: a.name, teamB: b.name, overlaps };
}

export function runScheduler() {
  const results = schedule(state.teams, state.matches, state.windows);
  return {
    total: results.length,
    scheduled: results.filter((r) => r.status === "scheduled").length,
    conflicts: results.filter((r) => r.status === "conflict").length,
    results,
  };
}

export function extendRoundWindow(round: RoundCode, extraMinutes: number) {
  const w = state.windows.find((r) => r.round === round);
  if (!w) {
    return {
      error: `Round '${round}' not found.`,
      knownRounds: state.windows.map((r) => r.round),
    };
  }
  const newEnd = new Date(toMs(w.end) + extraMinutes * 60_000).toISOString();
  const oldEnd = w.end;
  w.end = newEnd;
  return { round, oldEnd, newEnd, extendedBy: `${extraMinutes} minutes` };
}

export function addTeamAvailability(team: string, start: string, end: string) {
  const t = state.teams.find(
    (x) => x.name.toLowerCase() === team.toLowerCase(),
  );
  if (!t) {
    return {
      error: `Team '${team}' not found.`,
      knownTeams: getKnownTeamNames(),
    };
  }
  if (toMs(end) <= toMs(start)) {
    return { error: "`end` must be after `start`." };
  }
  t.availability.push({ start, end });
  return { team: t.name, added: { start, end }, availability: t.availability };
}

export function resetTournament() {
  state.teams = structuredClone(sampleTeams);
  state.matches = structuredClone(sampleMatches);
  state.windows = structuredClone(sampleWindows);
}
