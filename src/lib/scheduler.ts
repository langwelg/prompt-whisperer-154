// Deterministic fallback scheduler — same logic as the Express server.
// Finds overlap windows between two teams' availability and places matches
// without double-booking.

export type Availability = { start: string; end: string }; // ISO strings
export type Team = { name: string; availability: Availability[] };
export type Match = {
  id: string;
  round: string;
  teamA: string;
  teamB: string;
  durationMin: number;
};
export type RoundWindow = { round: string; start: string; end: string };

export type ScheduledMatch = {
  id: string;
  round: string;
  teamA: string;
  teamB: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  status: "scheduled" | "conflict";
  reason?: string;
  suggestion?: string;
};

type Interval = { start: number; end: number };

const toMs = (s: string) => new Date(s).getTime();
const fromMs = (n: number) => new Date(n).toISOString();

function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of a) {
    for (const y of b) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end > start) out.push({ start, end });
    }
  }
  return out.sort((p, q) => p.start - q.start);
}

function subtract(slots: Interval[], busy: Interval[]): Interval[] {
  let result = [...slots];
  for (const b of busy) {
    const next: Interval[] = [];
    for (const s of result) {
      if (b.end <= s.start || b.start >= s.end) {
        next.push(s);
      } else {
        if (b.start > s.start) next.push({ start: s.start, end: b.start });
        if (b.end < s.end) next.push({ start: b.end, end: s.end });
      }
    }
    result = next;
  }
  return result;
}

export function schedule(
  teams: Team[],
  matches: Match[],
  roundWindows: RoundWindow[],
): ScheduledMatch[] {
  const teamAvail = new Map<string, Interval[]>();
  for (const t of teams) {
    teamAvail.set(
      t.name,
      t.availability.map((a) => ({ start: toMs(a.start), end: toMs(a.end) })),
    );
  }
  const windows = new Map(
    roundWindows.map((r) => [r.round, { start: toMs(r.start), end: toMs(r.end) }]),
  );
  const busy = new Map<string, Interval[]>();

  const out: ScheduledMatch[] = [];
  for (const m of matches) {
    const a = teamAvail.get(m.teamA) ?? [];
    const b = teamAvail.get(m.teamB) ?? [];
    const win = windows.get(m.round);
    let candidates = intersect(a, b);
    if (win) candidates = intersect(candidates, [win]);
    candidates = subtract(candidates, busy.get(m.teamA) ?? []);
    candidates = subtract(candidates, busy.get(m.teamB) ?? []);

    const durMs = m.durationMin * 60_000;
    const slot = candidates.find((c) => c.end - c.start >= durMs);

    if (!slot) {
      const rawOverlap = intersect(a, b);
      let suggestion = "Reschedule one team's availability to overlap.";
      if (rawOverlap.length && win) {
        suggestion = `Teams overlap outside the round window — extend ${m.round} window or move overlap inside it.`;
      } else if (rawOverlap.length) {
        const longest = rawOverlap.reduce((p, c) =>
          c.end - c.start > p.end - p.start ? c : p,
        );
        suggestion = `Longest overlap is ${Math.round((longest.end - longest.start) / 60000)} min — shorter than the ${m.durationMin} min match.`;
      }
      out.push({
        id: m.id,
        round: m.round,
        teamA: m.teamA,
        teamB: m.teamB,
        scheduledStart: null,
        scheduledEnd: null,
        status: "conflict",
        reason: rawOverlap.length
          ? "No usable slot inside round window without double-booking."
          : "Teams have no overlapping availability.",
        suggestion,
      });
      continue;
    }

    const start = slot.start;
    const end = start + durMs;
    out.push({
      id: m.id,
      round: m.round,
      teamA: m.teamA,
      teamB: m.teamB,
      scheduledStart: fromMs(start),
      scheduledEnd: fromMs(end),
      status: "scheduled",
    });
    busy.set(m.teamA, [...(busy.get(m.teamA) ?? []), { start, end }]);
    busy.set(m.teamB, [...(busy.get(m.teamB) ?? []), { start, end }]);
  }
  return out;
}

// Sample tournament — same shape as the Express version's sample data.
export const sampleTeams: Team[] = [
  {
    name: "PhantomAces",
    availability: [{ start: "2026-05-20T18:00:00Z", end: "2026-05-20T23:00:00Z" }],
  },
  {
    name: "VortexKings",
    availability: [{ start: "2026-05-20T19:00:00Z", end: "2026-05-20T22:00:00Z" }],
  },
  {
    name: "ShadowSyndicate",
    availability: [{ start: "2026-05-20T14:00:00Z", end: "2026-05-20T16:00:00Z" }],
  },
  {
    name: "NeonDrakes",
    availability: [{ start: "2026-05-20T20:00:00Z", end: "2026-05-20T23:00:00Z" }],
  },
  {
    name: "CrimsonWolves",
    availability: [{ start: "2026-05-20T18:30:00Z", end: "2026-05-20T22:30:00Z" }],
  },
  {
    name: "IronTitans",
    availability: [{ start: "2026-05-20T19:00:00Z", end: "2026-05-20T22:00:00Z" }],
  },
  {
    name: "EchoReapers",
    availability: [{ start: "2026-05-20T18:00:00Z", end: "2026-05-20T21:00:00Z" }],
  },
  {
    name: "BlazeProtocol",
    availability: [{ start: "2026-05-20T20:00:00Z", end: "2026-05-20T23:00:00Z" }],
  },
];

export const sampleMatches: Match[] = [
  { id: "QF1", round: "QF", teamA: "PhantomAces", teamB: "VortexKings", durationMin: 60 },
  { id: "QF2", round: "QF", teamA: "ShadowSyndicate", teamB: "NeonDrakes", durationMin: 60 },
  { id: "QF3", round: "QF", teamA: "CrimsonWolves", teamB: "IronTitans", durationMin: 60 },
  { id: "QF4", round: "QF", teamA: "EchoReapers", teamB: "BlazeProtocol", durationMin: 60 },
  { id: "SF1", round: "SF", teamA: "PhantomAces", teamB: "CrimsonWolves", durationMin: 75 },
];

export const sampleWindows: RoundWindow[] = [
  { round: "QF", start: "2026-05-20T18:00:00Z", end: "2026-05-20T23:00:00Z" },
  { round: "SF", start: "2026-05-20T20:00:00Z", end: "2026-05-20T23:30:00Z" },
];
