import { StatusPill } from "@/components/primitives/status-pill.js";
import { Button } from "@/components/ui/button.js";
import { fmtDate } from "@/features/format.js";
import { api, callApi } from "@/lib/api-client.js";
import { cn } from "@/lib/utils.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

/**
 * Phase 3 availability request create flow. Two visible steps:
 *
 *   1. Date range → preview fixtures.
 *   2. Confirm → POST /api/availability/requests creates the record.
 *
 * The original UX bundled an initial recipient picker step as well —
 * that lives behind a follow-up "Send notification" action on the detail
 * page rather than the create flow itself, so a manager can stage the
 * request before fanning out emails.
 */
export default function OfficialAvailabilityNew() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const today = new Date();
  const defaultFrom = today.toISOString().slice(0, 10);
  const inTwoWeeks = new Date(today.getTime() + 14 * 86_400_000);
  const defaultTo = inTwoWeeks.toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(defaultTo);

  const preview = useQuery({
    queryKey: ["availability", "preview", dateFrom, dateTo],
    queryFn: () =>
      callApi(
        api.GET("/api/availability/preview", {
          params: { query: { dateFrom, dateTo } },
        }),
      ),
    enabled: !!dateFrom && !!dateTo && dateFrom <= dateTo,
  });

  const create = useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/availability/requests", {
          body: { dateFrom, dateTo },
        }),
      ),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ["availability"] });
      void navigate(`/official/availability/${data.id}`);
    },
  });

  const fixtures = preview.data?.fixtures ?? [];

  return (
    <div className="mx-auto w-full max-w-2xl pb-24">
      <header className="border-border flex items-center gap-3 border-b p-3">
        <Link
          to="/official/availability"
          className="text-text-secondary hover:bg-surface-raised grid size-9 place-items-center rounded-md"
          aria-label="Back"
        >
          <ArrowLeftIcon className="size-5" />
        </Link>
        <strong className="text-sm">New availability request</strong>
      </header>

      <div className="space-y-4 px-4 py-6">
        <section>
          <p className="text-text-secondary text-[11px] font-semibold tracking-[0.06em] uppercase">
            Date range
          </p>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <Field
              label="From"
              type="date"
              value={dateFrom}
              onChange={setDateFrom}
            />
            <Field label="To" type="date" value={dateTo} onChange={setDateTo} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <PresetChip
              label="This weekend"
              onClick={() => setRangeDays(setDateFrom, setDateTo, 0, 2)}
            />
            <PresetChip
              label="Next 2 weeks"
              onClick={() => setRangeDays(setDateFrom, setDateTo, 0, 14)}
            />
            <PresetChip
              label="Next month"
              onClick={() => setRangeDays(setDateFrom, setDateTo, 0, 30)}
            />
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-text-secondary text-[11px] font-semibold tracking-[0.06em] uppercase">
              Fixtures in this range
            </p>
            <StatusPill tone="navy">{fixtures.length}</StatusPill>
          </div>
          {preview.isPending && (
            <div className="border-border bg-surface-raised text-text-secondary rounded-2xl border p-4 text-sm">
              Looking up fixtures…
            </div>
          )}
          {!preview.isPending && fixtures.length === 0 && (
            <div className="border-border bg-surface-raised text-text-secondary rounded-2xl border p-4 text-sm">
              No fixtures in this range. Try a wider window.
            </div>
          )}
          {fixtures.length > 0 && (
            <div className="space-y-2">
              {fixtures.map((f) => (
                <div
                  key={`${f.matchDate}:${f.playCricketMatchId}`}
                  className="border-border bg-surface rounded-xl border p-3"
                >
                  <div className="flex items-baseline justify-between">
                    <strong className="text-sm">
                      {fmtDate(f.matchDate, "EEE d MMM")} · vs {f.opposition}
                    </strong>
                    {f.competitionName && (
                      <span className="text-text-secondary text-[11px] font-semibold tracking-wider uppercase">
                        {f.competitionName}
                      </span>
                    )}
                  </div>
                  <p className="text-text-secondary mt-0.5 text-xs">
                    {[f.teamName, f.isHome ? "Home" : "Away", f.matchTime]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        {create.isError && (
          <p className="text-danger text-sm">
            Couldn't create the request, try again.
          </p>
        )}
      </div>

      <div className="border-border bg-surface/95 fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur md:static md:border-t-0">
        <div
          className={cn(
            "mx-auto flex max-w-2xl items-center justify-end gap-2 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),12px)]",
            "md:pb-3",
          )}
        >
          <Button asChild tone="outline">
            <Link to="/official/availability">Cancel</Link>
          </Button>
          <Button
            tone="primary"
            disabled={fixtures.length === 0 || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending
              ? "Creating…"
              : `Create request · ${fixtures.length} fixtures`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-text-secondary text-[11px] font-semibold tracking-[0.06em] uppercase">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        className="border-border bg-surface h-11 rounded-lg border px-3 text-sm"
      />
    </label>
  );
}

function PresetChip({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border-border bg-surface text-text-secondary rounded-full border px-3 py-1.5 text-xs font-medium"
    >
      {label}
    </button>
  );
}

function setRangeDays(
  setFrom: (s: string) => void,
  setTo: (s: string) => void,
  startDelta: number,
  endDelta: number,
) {
  const now = new Date();
  const from = new Date(now.getTime() + startDelta * 86_400_000);
  const to = new Date(now.getTime() + endDelta * 86_400_000);
  setFrom(from.toISOString().slice(0, 10));
  setTo(to.toISOString().slice(0, 10));
}
