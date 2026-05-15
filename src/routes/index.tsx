import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  schedule,
  sampleTeams,
  sampleMatches,
  sampleWindows,
  type ScheduledMatch,
} from "@/lib/scheduler";

export const Route = createFileRoute("/")({
  component: Index,
});

const defaultInput = JSON.stringify(
  { teams: sampleTeams, matches: sampleMatches, roundWindows: sampleWindows },
  null,
  2,
);

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function Index() {
  const [input, setInput] = useState(defaultInput);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ScheduledMatch[] | null>(null);

  const stats = useMemo(() => {
    if (!results) return null;
    const scheduled = results.filter((r) => r.status === "scheduled").length;
    const conflicts = results.length - scheduled;
    return { scheduled, conflicts, total: results.length };
  }, [results]);

  function run() {
    setError(null);
    try {
      const parsed = JSON.parse(input);
      const out = schedule(parsed.teams, parsed.matches, parsed.roundWindows);
      setResults(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid JSON");
      setResults(null);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Esports Organizer</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Deterministic match scheduler with conflict detection. Paste tournament
            JSON and run the scheduler — same logic as the Express version.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-2">
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Tournament input</h2>
              <button
                onClick={() => setInput(defaultInput)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Reset to sample
              </button>
            </div>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              spellCheck={false}
              className="h-[480px] w-full resize-none rounded-md border border-input bg-card p-3 font-mono text-xs"
            />
            <button
              onClick={run}
              className="mt-3 w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Run scheduler
            </button>
            {error && (
              <p className="mt-2 text-xs text-destructive">Error: {error}</p>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold">Results</h2>
            {!results && (
              <div className="flex h-[480px] items-center justify-center rounded-md border border-dashed border-input text-sm text-muted-foreground">
                Click "Run scheduler" to see output
              </div>
            )}
            {results && stats && (
              <>
                <div className="mb-3 flex gap-2 text-xs">
                  <span className="rounded-full bg-muted px-2 py-1">
                    {stats.total} matches
                  </span>
                  <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-emerald-600 dark:text-emerald-400">
                    {stats.scheduled} scheduled
                  </span>
                  {stats.conflicts > 0 && (
                    <span className="rounded-full bg-destructive/15 px-2 py-1 text-destructive">
                      {stats.conflicts} conflicts
                    </span>
                  )}
                </div>
                <ul className="space-y-2">
                  {results.map((r) => (
                    <li
                      key={r.id}
                      className="rounded-md border border-input bg-card p-3 text-sm"
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-medium">
                          <span className="text-muted-foreground">{r.round} · {r.id}</span>{" "}
                          — {r.teamA} vs {r.teamB}
                        </div>
                        <span
                          className={
                            "rounded-full px-2 py-0.5 text-xs " +
                            (r.status === "scheduled"
                              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                              : "bg-destructive/15 text-destructive")
                          }
                        >
                          {r.status}
                        </span>
                      </div>
                      {r.status === "scheduled" ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {fmt(r.scheduledStart)} → {fmt(r.scheduledEnd)}
                        </div>
                      ) : (
                        <div className="mt-1 space-y-1 text-xs">
                          <div className="text-destructive">{r.reason}</div>
                          {r.suggestion && (
                            <div className="text-muted-foreground">
                              💡 {r.suggestion}
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
