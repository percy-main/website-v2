import { Button } from "@/components/ui/button";
import { api, callApi } from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { useState } from "react";

function formatMatchDate(iso: string): string {
  const d = parseISO(iso);
  return isNaN(d.getTime()) ? iso : format(d, "dd/MM/yyyy");
}

interface DebriefLauncherProps {
  /** Send a user message into the chat. The launcher hands the agent a
   *  one-line prompt that names the match (id + opposition + date) so the
   *  debrief system prompt can pull pc_match_detail for it. */
  onLaunch: (text: string) => void;
}

/**
 * Initial card shown for an empty debrief thread. Lists Percy Main matches
 * from the last 14 days as clickable options + offers a free-text/URL
 * fallback. Picking any option fires the first user message; the agent's
 * system prompt takes it from there.
 */
export function DebriefLauncher({ onLaunch }: DebriefLauncherProps) {
  const recentQuery = useQuery({
    queryKey: ["scout", "debrief", "recent-matches"],
    queryFn: () => callApi(api.GET("/api/scout/debrief/recent-matches")),
  });

  const [freeText, setFreeText] = useState("");

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onLaunch(trimmed);
  };

  return (
    <div className="mx-auto my-6 max-w-xl rounded-lg border border-amber-200 bg-amber-50 p-4">
      <h3 className="my-0 text-sm font-semibold text-amber-900">
        Post-match debrief
      </h3>
      <p className="mt-1 text-sm text-amber-900/80">
        Pick a recent match to walk through, or paste a Play Cricket scorecard
        URL.
      </p>

      <div className="mt-3">
        {recentQuery.isLoading && (
          <div className="text-xs text-amber-900/60">Loading matches…</div>
        )}
        {recentQuery.error && (
          <div className="text-xs text-red-700">
            {recentQuery.error instanceof Error
              ? recentQuery.error.message
              : "Failed to load recent matches"}
          </div>
        )}
        {recentQuery.data?.matches.length === 0 && (
          <div className="text-xs text-amber-900/60">
            No Percy Main matches in the last 14 days.
          </div>
        )}
        <ul className="space-y-1.5">
          {recentQuery.data?.matches.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() =>
                  submit(
                    `Debriefing match ${m.id} — ${m.ourTeam} ${
                      m.homeAway === "home" ? "vs" : "at"
                    } ${m.opposition} on ${formatMatchDate(m.matchDate)}.`,
                  )
                }
                className="block w-full rounded border border-amber-200 bg-white px-3 py-2 text-left text-sm text-gray-900 shadow-sm hover:border-amber-400 hover:bg-amber-100"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">
                    {m.ourTeam}{" "}
                    <span className="text-gray-500">
                      {m.homeAway === "home" ? "vs" : "at"}
                    </span>{" "}
                    {m.opposition}
                  </span>
                  <span className="shrink-0 text-xs text-gray-500">
                    {formatMatchDate(m.matchDate)}
                  </span>
                </div>
                {m.result && (
                  <div className="mt-0.5 text-xs text-gray-600">{m.result}</div>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit(freeText);
          setFreeText("");
        }}
      >
        <input
          type="text"
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          placeholder="Or paste a Play Cricket scorecard URL"
          className="flex-1 rounded border border-amber-200 bg-white px-2 py-1.5 text-sm focus:border-amber-500 focus:outline-none"
        />
        <Button type="submit" size="sm" disabled={!freeText.trim()}>
          Start
        </Button>
      </form>
    </div>
  );
}
