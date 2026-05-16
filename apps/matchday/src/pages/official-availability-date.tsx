import { Button } from "@/components/ui/button.js";
import { fmtDate } from "@/features/format.js";
import { api, callApi, type ApiResponse } from "@/lib/api-client.js";
import { cn } from "@/lib/utils.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

type PerDateData =
  ApiResponse<"/api/availability/requests/{requestId}/dates/{date}">;
type Pool = PerDateData["pools"]["available"][number];
type NoResp = PerDateData["pools"]["noResponse"][number];
type Fixture = PerDateData["fixtures"][number];

type Tab = "available" | "unavailable" | "noResponse";

/**
 * Phase 3 per-date picker.
 *
 * Mobile (<md): three-tab segmented control (Available, Unavailable,
 * No response). On Available tab, tapping a player opens a
 * fixture-picker sheet to assign them.
 *
 * Desktop (md+): the same data laid out as a 3-column side-by-side view
 * (per DESIGN_PROMPT_official tile 7 / Flow 3). Below the columns sits
 * an assignment rail with a card per fixture showing X/11 and the
 * picked players. The tab control is hidden at md+ so everything is
 * visible at once.
 */
export default function OfficialAvailabilityDate() {
  const { requestId, date } = useParams();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("available");
  const [assignTarget, setAssignTarget] = useState<Pool | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["availability", "request", requestId, "date", date],
    queryFn: () =>
      callApi(
        api.GET("/api/availability/requests/{requestId}/dates/{date}", {
          params: {
            path: { requestId: requestId ?? "", date: date ?? "" },
          },
        }),
      ),
    enabled: !!requestId && !!date,
  });

  const assign = useMutation({
    mutationFn: (vars: {
      memberId: string;
      fixtureId: string;
      playerName: string;
    }) =>
      callApi(
        api.POST("/api/availability/requests/{requestId}/dates/{date}/assign", {
          params: {
            path: { requestId: requestId ?? "", date: date ?? "" },
          },
          body: {
            fixtureId: vars.fixtureId,
            memberId: vars.memberId,
            playerName: vars.playerName,
          },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["availability"] });
      setAssignTarget(null);
    },
  });

  if (isLoading) return <Skel />;
  if (isError || !data)
    return (
      <p className="text-text-secondary px-4 py-6 text-sm">
        Couldn't load this date.
      </p>
    );

  const pd = data;

  return (
    <div className="mx-auto w-full max-w-2xl pb-24 md:max-w-6xl">
      <header className="border-border flex items-center gap-3 border-b p-3">
        <Link
          to={`/official/availability/${requestId}`}
          className="text-text-secondary hover:bg-surface-raised grid size-9 place-items-center rounded-md"
          aria-label="Back"
        >
          <ArrowLeftIcon className="size-5" />
        </Link>
        <div>
          <strong className="text-sm">
            {fmtDate(date ?? "", "EEE d MMM")}
          </strong>
          <p className="text-text-secondary text-[11px]">
            {pd.fixtures.length} fixture{pd.fixtures.length === 1 ? "" : "s"}
          </p>
        </div>
      </header>

      {/* Mobile (<md): tabbed view. */}
      <div className="md:hidden">
        <div className="bg-surface-raised mx-4 mt-3 grid grid-cols-3 gap-1 rounded-xl p-1">
          <SegBtn
            active={tab === "available"}
            onClick={() => setTab("available")}
          >
            {pd.pools.available.length} Available
          </SegBtn>
          <SegBtn
            active={tab === "unavailable"}
            onClick={() => setTab("unavailable")}
          >
            {pd.pools.unavailable.length} Unavailable
          </SegBtn>
          <SegBtn
            active={tab === "noResponse"}
            onClick={() => setTab("noResponse")}
          >
            {pd.pools.noResponse.length} No response
          </SegBtn>
        </div>

        <section className="mt-3">
          {tab === "available" && (
            <AvailableList
              pools={pd.pools.available}
              fixtures={pd.fixtures}
              assignedIds={pd.assignedMemberIds}
              onAssign={(p) => setAssignTarget(p)}
            />
          )}
          {tab === "unavailable" && (
            <SimpleList items={pd.pools.unavailable} muted />
          )}
          {tab === "noResponse" && (
            <NoResponseList items={pd.pools.noResponse} />
          )}
        </section>
      </div>

      {/* Desktop (md+): 3-column side-by-side + assignment rail. */}
      <div className="hidden md:block">
        <div className="border-border bg-surface mx-4 mt-4 overflow-hidden rounded-2xl border">
          <div className="grid min-h-[480px] grid-cols-3">
            <DesktopColumn
              tone="available"
              label="Available"
              count={pd.pools.available.length}
            >
              <AvailableList
                pools={pd.pools.available}
                fixtures={pd.fixtures}
                assignedIds={pd.assignedMemberIds}
                onAssign={(p) => setAssignTarget(p)}
                compact
              />
            </DesktopColumn>
            <DesktopColumn
              tone="unavailable"
              label="Unavailable"
              count={pd.pools.unavailable.length}
            >
              <SimpleList items={pd.pools.unavailable} muted compact />
            </DesktopColumn>
            <DesktopColumn
              tone="noResponse"
              label="No response"
              count={pd.pools.noResponse.length}
            >
              <NoResponseList items={pd.pools.noResponse} compact />
            </DesktopColumn>
          </div>
          <AssignmentRail fixtures={pd.fixtures} />
        </div>
      </div>

      {assignTarget && (
        <AssignSheet
          target={assignTarget}
          fixtures={pd.fixtures}
          onCancel={() => setAssignTarget(null)}
          onAssign={(fixtureId) =>
            assign.mutate({
              memberId: assignTarget.member_id,
              fixtureId,
              playerName: assignTarget.member_name ?? "Unknown",
            })
          }
          pending={assign.isPending}
        />
      )}
    </div>
  );
}

function DesktopColumn({
  tone,
  label,
  count,
  children,
}: {
  tone: "available" | "unavailable" | "noResponse";
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  const headTone = {
    available: "bg-success-bg text-success border-b border-success/30",
    unavailable: "bg-danger-bg text-danger border-b border-danger/30",
    noResponse: "border-border bg-surface-raised text-text-secondary border-b",
  }[tone];
  return (
    <div className="border-border flex flex-col border-r last:border-r-0">
      <div
        className={cn(
          "flex items-center justify-between px-4 py-2.5 text-[11px] font-semibold tracking-[0.06em] uppercase",
          headTone,
        )}
      >
        <span>{label}</span>
        <span>{count}</span>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function AssignmentRail({ fixtures }: { fixtures: Fixture[] }) {
  return (
    <div className="border-border bg-surface-raised border-t p-4">
      <p className="text-text-secondary mb-2 text-[11px] font-semibold tracking-[0.06em] uppercase">
        Current assignments
      </p>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {fixtures.map((f) => (
          <div
            key={f.id}
            className="border-border bg-surface rounded-xl border p-3"
          >
            <div className="flex items-baseline justify-between">
              <strong className="text-sm">
                {f.team_name ?? "Senior"} vs {f.opposition}
              </strong>
              <span className="text-text-secondary text-[11px] font-semibold">
                {f.assignments.length} / 11
              </span>
            </div>
            <p className="text-text-secondary mt-2 text-xs">
              {f.assignments.length === 0
                ? "No one picked yet."
                : f.assignments
                    .slice(0, 6)
                    .map((a) => a.player_name)
                    .join(", ") +
                  (f.assignments.length > 6
                    ? `, +${f.assignments.length - 6} more`
                    : "")}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SegBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg py-2 text-center text-xs font-semibold",
        active
          ? "bg-surface text-navy shadow-sm dark:text-white"
          : "text-text-secondary",
      )}
    >
      {children}
    </button>
  );
}

function AvailableList({
  pools,
  fixtures,
  assignedIds,
  onAssign,
  compact,
}: {
  pools: Pool[];
  fixtures: Fixture[];
  assignedIds: string[];
  onAssign: (p: Pool) => void;
  compact?: boolean;
}) {
  const assigned = new Set(assignedIds);
  const pad = compact ? "px-4 py-2" : "px-4 py-3";
  return (
    <div className="divide-border-light divide-y">
      {pools.length === 0 && (
        <p className="text-text-secondary px-4 py-6 text-sm">
          No one's said yes yet.
        </p>
      )}
      {pools.map((p) => {
        const assignedFix = fixtures.find((f) =>
          f.assignments.some((a) => a.member_id === p.member_id),
        );
        return (
          <div
            key={p.id}
            className={cn("bg-surface flex items-center gap-3", pad)}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{p.member_name}</p>
              {p.note && (
                <p className="text-text-secondary truncate text-xs">
                  "{p.note}"
                </p>
              )}
            </div>
            {assignedFix ? (
              <span className="bg-info-bg text-navy rounded-full px-2.5 py-1 text-[11px] font-semibold">
                {assignedFix.team_name ?? assignedFix.opposition}
              </span>
            ) : assigned.has(p.member_id) ? null : (
              <Button size="sm" tone="ghost" onClick={() => onAssign(p)}>
                Assign →
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SimpleList({
  items,
  muted,
  compact,
}: {
  items: Pool[];
  muted?: boolean;
  compact?: boolean;
}) {
  const pad = compact ? "px-4 py-2" : "px-4 py-3";
  return (
    <div className={cn("divide-border-light divide-y", muted && "opacity-80")}>
      {items.length === 0 && (
        <p className="text-text-secondary px-4 py-6 text-sm">No one here.</p>
      )}
      {items.map((p) => (
        <div key={p.id} className={cn("bg-surface", pad)}>
          <p className="text-sm font-medium">{p.member_name}</p>
          {p.note && <p className="text-text-secondary text-xs">"{p.note}"</p>}
        </div>
      ))}
    </div>
  );
}

function NoResponseList({
  items,
  compact,
}: {
  items: NoResp[];
  compact?: boolean;
}) {
  const pad = compact ? "px-4 py-2" : "px-4 py-3";
  return (
    <div className="divide-border-light divide-y">
      {items.length === 0 && (
        <p className="text-text-secondary px-4 py-6 text-sm">
          Everyone's responded. Nice.
        </p>
      )}
      {items.map((m) => (
        <div
          key={m.id}
          className={cn("bg-surface flex items-center gap-3", pad)}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{m.name}</p>
            {m.member_category && (
              <p className="text-text-secondary text-xs">{m.member_category}</p>
            )}
          </div>
          {/* Nudging individuals is a phase 3.1 surface (uses
              POST /availability/requests/:id/notify/send) — for now,
              chase from the request-detail page. */}
        </div>
      ))}
    </div>
  );
}

function AssignSheet({
  target,
  fixtures,
  onCancel,
  onAssign,
  pending,
}: {
  target: Pool;
  fixtures: Fixture[];
  onCancel: () => void;
  onAssign: (fixtureId: string) => void;
  pending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 md:items-center">
      <div className="bg-surface w-full max-w-md rounded-t-3xl p-5 pb-[max(env(safe-area-inset-bottom),24px)] shadow-2xl md:rounded-3xl">
        <div className="bg-border mx-auto mb-3 h-1 w-9 rounded-full" />
        <h2 className="text-lg font-semibold">Assign {target.member_name}</h2>
        <p className="text-text-secondary mt-1 text-sm">
          Pick which fixture to put them in.
        </p>
        <div className="mt-4 space-y-2">
          {fixtures.length === 0 && (
            <p className="bg-border-light text-text-secondary rounded-xl px-4 py-3 text-sm">
              No fixtures on this date.
            </p>
          )}
          {fixtures.map((f) => (
            <button
              key={f.id}
              type="button"
              disabled={pending}
              onClick={() => onAssign(f.id)}
              className="border-border bg-surface flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left disabled:opacity-60"
            >
              <div>
                <p className="text-sm font-semibold">
                  {f.team_name ?? "Senior"} vs {f.opposition}
                </p>
                <p className="text-text-secondary text-xs">
                  {[
                    f.is_home ? "Home" : "Away",
                    f.competition_name,
                    f.match_time,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <span className="text-text-secondary text-[11px] font-semibold">
                {f.assignments.length} / 11
              </span>
            </button>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button tone="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

function Skel() {
  return (
    <div className="space-y-2 px-4 py-4">
      <div className="bg-border h-10 rounded-xl" />
      <div className="bg-border h-12 rounded-xl" />
      <div className="bg-border h-12 rounded-xl" />
    </div>
  );
}
