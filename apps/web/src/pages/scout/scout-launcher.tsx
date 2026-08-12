import { ImbuzaiMascot } from "@/components/imbuzai-mascot.js";
import { Button } from "@/components/ui/button";
import { api, callApi } from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { useState } from "react";

function formatMatchDate(iso: string): string {
  const d = parseISO(iso);
  return isNaN(d.getTime()) ? iso : format(d, "EEE d MMM");
}

interface ScoutLauncherProps {
  /** Send a user message into the chat. The launcher hands the agent a
   *  one-line prompt that names the match (id + opposition + date) so the
   *  focused scout system prompt scopes the session to that fixture. */
  onLaunch: (text: string) => void;
}

/**
 * Initial card shown for an empty scout thread. Lists Percy Main fixtures
 * over the next 14 days as clickable options + offers a free-text fallback
 * for matches not yet in the local availability mirror.
 */
export function ScoutLauncher({ onLaunch }: ScoutLauncherProps) {
  const {
    data: upcoming,
    isLoading: upcomingLoading,
    error: upcomingError,
  } = useQuery({
    queryKey: ["scout", "scout", "upcoming-matches"],
    queryFn: () => callApi(api.GET("/api/scout/upcoming-matches")),
  });

  const [freeText, setFreeText] = useState("");

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onLaunch(trimmed);
  };

  return (
    <div className="mx-auto my-6 max-w-xl rounded-lg border border-emerald-200 bg-emerald-50 p-4">
      <div className="flex items-start gap-3">
        <ImbuzaiMascot width={48} className="shrink-0" />
        <div>
          <h3 className="my-0 text-sm font-semibold text-emerald-900">
            Scout an upcoming match
          </h3>
          <p className="mt-1 text-sm text-emerald-900/80">
            Pick a fixture in the next two weeks, or describe a match below.
            ImbuzAI will gather selection, opposition stats, weather and
            references, then generate a PDF.
          </p>
        </div>
      </div>

      <div className="mt-3">
        {upcomingLoading && (
          <div className="text-xs text-emerald-900/60">Loading fixtures…</div>
        )}
        {upcomingError && (
          <div className="text-xs text-red-700">
            {upcomingError instanceof Error
              ? upcomingError.message
              : "Failed to load upcoming fixtures"}
          </div>
        )}
        {upcoming?.matches.length === 0 && (
          <div className="text-xs text-emerald-900/60">
            No Percy Main fixtures in the next 14 days. Use the box below to
            describe the match.
          </div>
        )}
        <ul className="space-y-1.5">
          {upcoming?.matches.map((m) => (
            <li key={`${m.id}-${m.matchDate}`}>
              <button
                type="button"
                onClick={() =>
                  submit(
                    `Scouting upcoming match ${m.id} — ${m.ourTeam} ${
                      m.homeAway === "home" ? "vs" : "at"
                    } ${m.opposition} on ${formatMatchDate(m.matchDate)}${
                      m.matchTime ? `, ${m.matchTime}` : ""
                    }${m.competition ? ` (${m.competition})` : ""}.`,
                  )
                }
                className="block w-full rounded border border-emerald-200 bg-white px-3 py-2 text-left text-sm text-stone-900 shadow-sm hover:border-emerald-400 hover:shadow-md"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">
                    {m.ourTeam}{" "}
                    <span className="text-stone-500">
                      {m.homeAway === "home" ? "vs" : "at"}
                    </span>{" "}
                    {m.opposition}
                  </span>
                  <span className="shrink-0 text-xs text-stone-500">
                    {formatMatchDate(m.matchDate)}
                    {m.matchTime ? ` · ${m.matchTime}` : ""}
                  </span>
                </div>
                {m.competition && (
                  <div className="mt-0.5 text-xs text-stone-600">
                    {m.competition}
                  </div>
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
          aria-label="Describe the match (team, opposition, date)"
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          placeholder="Or describe the match (team, opposition, date)"
          className="flex-1 rounded border border-emerald-200 bg-white px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
        />
        <Button type="submit" size="sm" disabled={!freeText.trim()}>
          Start
        </Button>
      </form>
    </div>
  );
}
