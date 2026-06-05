import { Button } from "@/components/ui/button.js";
import { ConfirmDialog } from "@/components/ui/confirm-dialog.js";
import { fmtDate } from "@/features/format.js";
import { useDebouncedValue } from "@/hooks/use-debounced-value.js";
import { api, callApi, type ApiResponse } from "@/lib/api-client.js";
import { cn } from "@/lib/utils.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  SearchIcon,
  UserPlusIcon,
  XIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";

type PerDateData =
  ApiResponse<"/api/availability/requests/{requestId}/dates/{date}">;
type Pool = PerDateData["pools"]["available"][number];
type NoResp = PerDateData["pools"]["noResponse"][number];
type Fixture = PerDateData["fixtures"][number];
type Assignment = Fixture["assignments"][number];
type OverrideStatus = "available" | "unavailable";

type Tab = "available" | "unavailable" | "noResponse";

/**
 * Phase 3 per-date picker.
 *
 * Mobile (<md): three-tab segmented control (Available, Unavailable,
 * No response). Each row exposes the same actions as the desktop view -
 * assign / move / mark available / mark unavailable.
 *
 * Desktop (md+): the same data laid out as a 3-column side-by-side view
 * (per DESIGN_PROMPT_official tile 7 / Flow 3). Below the columns sits
 * an assignment rail with a card per fixture showing X/11 and the
 * picked players; each assigned player has an inline Remove button so
 * officials can swap people between teams without leaving the screen.
 *
 * A search input at the top filters all three pools by name. A guest
 * entry block lets officials add a non-member directly to a fixture.
 */
export default function OfficialAvailabilityDate() {
  const { requestId, date } = useParams();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("available");
  const [assignTarget, setAssignTarget] = useState<Pool | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearch = useDebouncedValue(searchTerm, 200);

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

  const invalidate = () =>
    void qc.invalidateQueries({
      queryKey: ["availability", "request", requestId, "date", date],
    });

  const assign = useMutation({
    mutationFn: (vars: {
      memberId?: string;
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
            ...(vars.memberId ? { memberId: vars.memberId } : {}),
            playerName: vars.playerName,
          },
        }),
      ),
    onSuccess: () => {
      invalidate();
      setAssignTarget(null);
    },
  });

  const unassign = useMutation({
    mutationFn: (assignmentId: string) =>
      callApi(
        api.DELETE("/api/availability/assignments/{assignmentId}", {
          params: { path: { assignmentId } },
        }),
      ),
    onSuccess: () => {
      invalidate();
    },
  });

  const move = useMutation({
    // Move = delete the existing assignment, then create a new one on the
    // target fixture. The API doesn't have a single "move" endpoint and
    // a duplicate assign would 409, so the two-step is the only path.
    mutationFn: async (vars: {
      assignmentId: string;
      memberId: string;
      playerName: string;
      fixtureId: string;
    }) => {
      await callApi(
        api.DELETE("/api/availability/assignments/{assignmentId}", {
          params: { path: { assignmentId: vars.assignmentId } },
        }),
      );
      return callApi(
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
      );
    },
    onSuccess: () => {
      invalidate();
      setAssignTarget(null);
    },
  });

  const confirmFixture = useMutation({
    mutationFn: (fixtureId: string) =>
      callApi(
        api.POST(
          "/api/availability/requests/{requestId}/dates/{date}/fixtures/{fixtureId}/confirm",
          {
            params: {
              path: {
                requestId: requestId ?? "",
                date: date ?? "",
                fixtureId,
              },
            },
          },
        ),
      ),
    onSuccess: () => {
      invalidate();
      // The fixture now has a matchday - refresh the request detail (its
      // confirmed count badge), the fixtures list (Pick team CTA), and any
      // open request views so they all reflect the confirmed team.
      void qc.invalidateQueries({
        queryKey: ["availability", "request", requestId],
      });
      void qc.invalidateQueries({ queryKey: ["games"] });
    },
  });

  const override = useMutation({
    mutationFn: (vars: { memberId: string; status: OverrideStatus }) =>
      callApi(
        api.PUT(
          "/api/availability/requests/{requestId}/dates/{date}/members/{memberId}/availability",
          {
            params: {
              path: {
                requestId: requestId ?? "",
                date: date ?? "",
                memberId: vars.memberId,
              },
            },
            body: { status: vars.status },
          },
        ),
      ),
    onSuccess: invalidate,
  });

  if (isLoading) return <Skel />;
  if (isError || !data)
    return (
      <p className="text-text-secondary px-4 py-6 text-sm">
        Couldn't load this date.
      </p>
    );

  const pd = data;
  const filter = debouncedSearch.trim().toLowerCase();
  const matchPool = (p: Pool) =>
    filter === "" || (p.member_name ?? "").toLowerCase().includes(filter);
  const matchNoResp = (m: NoResp) =>
    filter === "" || (m.name ?? "").toLowerCase().includes(filter);

  const available = pd.pools.available.filter(matchPool);
  const unavailable = pd.pools.unavailable.filter(matchPool);
  const noResponse = pd.pools.noResponse.filter(matchNoResp);

  // Once a fixture is confirmed its squad is snapshotted into the
  // matchday, so assignment edits here would no longer reach it. Confined
  // assign/move/guest targets to still-open fixtures; the Teams rail still
  // lists every fixture (confirmed ones get a "Manage squad" link).
  const openFixtures = pd.fixtures.filter((f) => !f.matchdayId);

  // Index of each member's current assignment (if any) so each list can
  // surface a "currently in <team>" pill and "Move" action without a
  // per-row scan of every fixture.
  const assignmentByMember = new Map<
    string,
    { fixture: Fixture; assignment: Assignment }
  >();
  for (const f of pd.fixtures) {
    for (const a of f.assignments) {
      if (a.member_id)
        assignmentByMember.set(a.member_id, { fixture: f, assignment: a });
    }
  }

  const actions = {
    assign: (
      memberId: string | undefined,
      playerName: string,
      fixtureId: string,
    ) => assign.mutate({ memberId, playerName, fixtureId }),
    move: (vars: {
      assignmentId: string;
      memberId: string;
      playerName: string;
      fixtureId: string;
    }) => move.mutate(vars),
    unassign: (assignmentId: string) => unassign.mutate(assignmentId),
    setAvailable: (memberId: string) =>
      override.mutate({ memberId, status: "available" }),
    setUnavailable: (memberId: string) =>
      override.mutate({ memberId, status: "unavailable" }),
    openAssignSheet: (p: Pool) => setAssignTarget(p),
  };

  const actionPending =
    assign.isPending ||
    unassign.isPending ||
    move.isPending ||
    override.isPending;

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

      <div className="px-4 pt-3">
        <SearchInput value={searchTerm} onChange={setSearchTerm} />
      </div>

      {confirmFixture.isError && (
        <p className="text-danger mx-4 mt-3 text-sm">
          Couldn't confirm that team. It may already have a matchday - reload
          and check.
        </p>
      )}

      {/* Mobile (<md): tabbed view. */}
      <div className="md:hidden">
        <div className="bg-surface-raised mx-4 mt-3 grid grid-cols-3 gap-1 rounded-xl p-1">
          <SegBtn
            active={tab === "available"}
            onClick={() => setTab("available")}
          >
            {available.length} Available
          </SegBtn>
          <SegBtn
            active={tab === "unavailable"}
            onClick={() => setTab("unavailable")}
          >
            {unavailable.length} Unavailable
          </SegBtn>
          <SegBtn
            active={tab === "noResponse"}
            onClick={() => setTab("noResponse")}
          >
            {noResponse.length} No response
          </SegBtn>
        </div>

        <section className="mt-3">
          {tab === "available" && (
            <AvailableList
              players={available}
              fixtures={openFixtures}
              assignmentByMember={assignmentByMember}
              actions={actions}
              actionPending={actionPending}
            />
          )}
          {tab === "unavailable" && (
            <UnavailableList
              players={unavailable}
              actions={actions}
              actionPending={actionPending}
            />
          )}
          {tab === "noResponse" && (
            <NoResponseList
              players={noResponse}
              actions={actions}
              actionPending={actionPending}
            />
          )}
        </section>

        <div className="mt-6">
          <AssignmentRail
            fixtures={pd.fixtures}
            onRemove={actions.unassign}
            removing={unassign.isPending}
            onConfirm={(fixtureId) => confirmFixture.mutate(fixtureId)}
            confirming={confirmFixture.isPending}
          />
        </div>

        <div className="border-border-light mt-2 border-t px-4 pt-4">
          <GuestEntry fixtures={openFixtures} onAdd={actions.assign} />
        </div>
      </div>

      {/* Desktop (md+): 3-column side-by-side + assignment rail. */}
      <div className="hidden md:block">
        <div className="border-border bg-surface mx-4 mt-4 overflow-hidden rounded-2xl border">
          <div className="grid min-h-[480px] grid-cols-3">
            <DesktopColumn
              tone="available"
              label="Available"
              count={available.length}
            >
              <AvailableList
                players={available}
                fixtures={openFixtures}
                assignmentByMember={assignmentByMember}
                actions={actions}
                actionPending={actionPending}
                compact
              />
            </DesktopColumn>
            <DesktopColumn
              tone="unavailable"
              label="Unavailable"
              count={unavailable.length}
            >
              <UnavailableList
                players={unavailable}
                actions={actions}
                actionPending={actionPending}
                compact
              />
            </DesktopColumn>
            <DesktopColumn
              tone="noResponse"
              label="No response"
              count={noResponse.length}
            >
              <NoResponseList
                players={noResponse}
                actions={actions}
                actionPending={actionPending}
                compact
              />
            </DesktopColumn>
          </div>
          <AssignmentRail
            fixtures={pd.fixtures}
            onRemove={actions.unassign}
            removing={unassign.isPending}
            onConfirm={(fixtureId) => confirmFixture.mutate(fixtureId)}
            confirming={confirmFixture.isPending}
          />
          <div className="border-border bg-surface-raised border-t p-4">
            <GuestEntry fixtures={openFixtures} onAdd={actions.assign} />
          </div>
        </div>
      </div>

      {assignTarget && (
        <AssignSheet
          target={assignTarget}
          fixtures={openFixtures}
          currentAssignment={
            assignmentByMember.get(assignTarget.member_id)?.assignment ?? null
          }
          onCancel={() => setAssignTarget(null)}
          onAssign={(fixtureId) => {
            const current = assignmentByMember.get(assignTarget.member_id);
            if (current) {
              move.mutate({
                assignmentId: current.assignment.id,
                memberId: assignTarget.member_id,
                playerName: assignTarget.member_name ?? "Unknown",
                fixtureId,
              });
            } else {
              actions.assign(
                assignTarget.member_id,
                assignTarget.member_name ?? "Unknown",
                fixtureId,
              );
            }
          }}
          onUnassign={() => {
            const current = assignmentByMember.get(assignTarget.member_id);
            if (current) actions.unassign(current.assignment.id);
          }}
          pending={actionPending}
        />
      )}
    </div>
  );
}

interface ListActions {
  assign: (
    memberId: string | undefined,
    playerName: string,
    fixtureId: string,
  ) => void;
  move: (vars: {
    assignmentId: string;
    memberId: string;
    playerName: string;
    fixtureId: string;
  }) => void;
  unassign: (assignmentId: string) => void;
  setAvailable: (memberId: string) => void;
  setUnavailable: (memberId: string) => void;
  openAssignSheet: (p: Pool) => void;
}

function SearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="bg-surface-raised flex items-center gap-2 rounded-xl px-3 py-2">
      <SearchIcon className="text-text-secondary size-4" />
      <input
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        placeholder="Search players…"
        className="placeholder:text-text-muted w-full bg-transparent text-sm outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="text-text-secondary hover:text-text grid size-6 place-items-center rounded"
        >
          <XIcon className="size-4" />
        </button>
      )}
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
  players,
  fixtures,
  assignmentByMember,
  actions,
  actionPending,
  compact,
}: {
  players: Pool[];
  fixtures: Fixture[];
  assignmentByMember: Map<string, { fixture: Fixture; assignment: Assignment }>;
  actions: ListActions;
  actionPending: boolean;
  compact?: boolean;
}) {
  const pad = compact ? "px-4 py-2" : "px-4 py-3";
  return (
    <div className="divide-border-light divide-y">
      {players.length === 0 && (
        <p className="text-text-secondary px-4 py-6 text-sm">No one matches.</p>
      )}
      {players.map((p) => {
        const current = assignmentByMember.get(p.member_id);
        // A player snapshotted into a confirmed matchday can't be moved
        // from here - the team is owned by the matchday screen now - so we
        // show their team as a static label rather than a move button.
        const lockedIn = current?.fixture.matchdayId != null;
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
              {p.overridden_by && (
                <p className="text-warning text-[10px] font-semibold tracking-wide uppercase">
                  Overridden
                </p>
              )}
            </div>
            {current ? (
              lockedIn ? (
                <span className="bg-success-bg text-success rounded-full px-2.5 py-1 text-[11px] font-semibold">
                  {current.fixture.team_name ?? current.fixture.opposition} ✓
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => actions.openAssignSheet(p)}
                  disabled={actionPending}
                  className="bg-info-bg text-navy rounded-full px-2.5 py-1 text-[11px] font-semibold disabled:opacity-60 dark:text-white"
                >
                  {current.fixture.team_name ?? current.fixture.opposition}
                </button>
              )
            ) : fixtures.length === 0 ? null : fixtures.length === 1 ? (
              <Button
                size="sm"
                tone="ghost"
                disabled={actionPending}
                onClick={() =>
                  actions.assign(
                    p.member_id,
                    p.member_name ?? "Unknown",
                    fixtures[0].id,
                  )
                }
              >
                Assign →
              </Button>
            ) : (
              <Button
                size="sm"
                tone="ghost"
                disabled={actionPending}
                onClick={() => actions.openAssignSheet(p)}
              >
                Assign →
              </Button>
            )}
            <button
              type="button"
              onClick={() => actions.setUnavailable(p.member_id)}
              disabled={actionPending}
              className="text-text-secondary hover:text-danger text-[11px] font-medium disabled:opacity-60"
            >
              Mark unavail.
            </button>
          </div>
        );
      })}
    </div>
  );
}

function UnavailableList({
  players,
  actions,
  actionPending,
  compact,
}: {
  players: Pool[];
  actions: ListActions;
  actionPending: boolean;
  compact?: boolean;
}) {
  const pad = compact ? "px-4 py-2" : "px-4 py-3";
  return (
    <div className="divide-border-light divide-y opacity-90">
      {players.length === 0 && (
        <p className="text-text-secondary px-4 py-6 text-sm">No one here.</p>
      )}
      {players.map((p) => (
        <div
          key={p.id}
          className={cn("bg-surface flex items-center gap-3", pad)}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{p.member_name}</p>
            {p.note && (
              <p className="text-text-secondary truncate text-xs">"{p.note}"</p>
            )}
            {p.overridden_by && (
              <p className="text-warning text-[10px] font-semibold tracking-wide uppercase">
                Overridden
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => actions.setAvailable(p.member_id)}
            disabled={actionPending}
            className="text-success text-[11px] font-medium disabled:opacity-60"
          >
            Mark avail.
          </button>
        </div>
      ))}
    </div>
  );
}

function NoResponseList({
  players,
  actions,
  actionPending,
  compact,
}: {
  players: NoResp[];
  actions: ListActions;
  actionPending: boolean;
  compact?: boolean;
}) {
  const pad = compact ? "px-4 py-2" : "px-4 py-3";
  return (
    <div className="divide-border-light divide-y">
      {players.length === 0 && (
        <p className="text-text-secondary px-4 py-6 text-sm">No one here.</p>
      )}
      {players.map((m) => (
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
          <button
            type="button"
            onClick={() => actions.setAvailable(m.id)}
            disabled={actionPending}
            className="text-success text-[11px] font-medium disabled:opacity-60"
          >
            Avail.
          </button>
          <button
            type="button"
            onClick={() => actions.setUnavailable(m.id)}
            disabled={actionPending}
            className="text-danger text-[11px] font-medium disabled:opacity-60"
          >
            Unavail.
          </button>
        </div>
      ))}
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

function AssignmentRail({
  fixtures,
  onRemove,
  removing,
  onConfirm,
  confirming,
}: {
  fixtures: Fixture[];
  onRemove: (assignmentId: string) => void;
  removing: boolean;
  onConfirm: (fixtureId: string) => void;
  confirming: boolean;
}) {
  return (
    <div className="border-border bg-surface-raised border-t p-4">
      <p className="text-text-secondary mb-2 text-[11px] font-semibold tracking-[0.06em] uppercase">
        Teams
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
            {f.assignments.length === 0 ? (
              <p className="text-text-secondary mt-2 text-xs">
                No one picked yet.
              </p>
            ) : (
              <ol className="mt-2 space-y-1">
                {f.assignments.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="truncate">
                      <span className="text-text-secondary mr-1.5 tabular-nums">
                        {a.position}.
                      </span>
                      {a.player_name}
                      {!a.member_id && (
                        <span className="text-text-secondary ml-1.5 italic">
                          (guest)
                        </span>
                      )}
                    </span>
                    {/* Once confirmed the squad is owned by the matchday
                        screen, so removing a pick here would no longer
                        reach it - hide the action to avoid that trap. */}
                    {!f.matchdayId && (
                      <button
                        type="button"
                        onClick={() => onRemove(a.id)}
                        disabled={removing}
                        className="text-text-secondary hover:text-danger ml-2 text-[11px] disabled:opacity-60"
                      >
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            )}
            <ConfirmTeamControl
              fixture={f}
              onConfirm={onConfirm}
              confirming={confirming}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Per-fixture confirm control. Turning a provisional team into a matchday
 * is what lets an official lock in one game while the request stays open
 * for the others. Once confirmed, the squad is managed on the matchday
 * screen, so we swap the button for a link there.
 */
function ConfirmTeamControl({
  fixture,
  onConfirm,
  confirming,
}: {
  fixture: Fixture;
  onConfirm: (fixtureId: string) => void;
  confirming: boolean;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  if (fixture.matchdayId) {
    return (
      <div className="border-border-light mt-3 flex items-center justify-between border-t pt-3">
        <span className="text-success inline-flex items-center gap-1.5 text-xs font-semibold">
          <CheckCircle2Icon className="size-4" />
          Team confirmed
        </span>
        <Link
          to={`/matchday/${fixture.matchdayId}/edit`}
          className="text-navy text-xs font-semibold underline dark:text-white"
        >
          Manage squad →
        </Link>
      </div>
    );
  }
  if (fixture.assignments.length === 0) return null;
  return (
    <>
      <Button
        tone="primary"
        size="sm"
        className="mt-3 w-full"
        disabled={confirming}
        onClick={() => {
          setConfirmOpen(true);
        }}
      >
        {confirming ? "Confirming…" : "Confirm team →"}
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Confirm this team?"
        description={`This creates the matchday for ${fixture.team_name ?? "this team"} vs ${fixture.opposition}. Players can still update availability for other games in this request.`}
        confirmLabel="Confirm team"
        pending={confirming}
        onConfirm={() => {
          onConfirm(fixture.id);
          setConfirmOpen(false);
        }}
      />
    </>
  );
}

function GuestEntry({
  fixtures,
  onAdd,
}: {
  fixtures: Fixture[];
  onAdd: (
    memberId: string | undefined,
    playerName: string,
    fixtureId: string,
  ) => void;
}) {
  const [name, setName] = useState("");
  const [fixtureId, setFixtureId] = useState(fixtures[0]?.id ?? "");
  const fixtureValue = useMemo(
    () =>
      fixtures.find((f) => f.id === fixtureId)
        ? fixtureId
        : (fixtures[0]?.id ?? ""),
    [fixtures, fixtureId],
  );
  const canAdd = name.trim().length > 0 && !!fixtureValue;
  // No open fixtures left to add to (all confirmed) - nothing to do here.
  if (fixtures.length === 0) return null;
  return (
    <div>
      <p className="text-text-secondary mb-2 text-[11px] font-semibold tracking-[0.06em] uppercase">
        Add a guest
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="Guest name"
          className="border-border bg-surface h-10 min-w-[10rem] flex-1 rounded-lg border px-3 text-sm"
        />
        {fixtures.length > 1 && (
          <select
            value={fixtureValue}
            onChange={(e) => setFixtureId(e.currentTarget.value)}
            className="border-border bg-surface h-10 rounded-lg border px-3 text-sm"
          >
            {fixtures.map((f) => (
              <option key={f.id} value={f.id}>
                {f.team_name ?? "Senior"} vs {f.opposition}
              </option>
            ))}
          </select>
        )}
        <Button
          tone="outline"
          disabled={!canAdd}
          onClick={() => {
            onAdd(undefined, name.trim(), fixtureValue);
            setName("");
          }}
        >
          <UserPlusIcon className="size-4" />
          Add
        </Button>
      </div>
      <p className="text-text-secondary mt-1 text-[11px]">
        Guests don't receive donation emails - useful for ringers, mates'
        cousins, etc.
      </p>
    </div>
  );
}

function AssignSheet({
  target,
  fixtures,
  currentAssignment,
  onCancel,
  onAssign,
  onUnassign,
  pending,
}: {
  target: Pool;
  fixtures: Fixture[];
  currentAssignment: Assignment | null;
  onCancel: () => void;
  onAssign: (fixtureId: string) => void;
  onUnassign: () => void;
  pending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 md:items-center">
      <div className="bg-surface w-full max-w-md rounded-t-3xl p-5 pb-[max(env(safe-area-inset-bottom),24px)] shadow-2xl md:rounded-3xl">
        <div className="bg-border mx-auto mb-3 h-1 w-9 rounded-full" />
        <h2 className="text-lg font-semibold">
          {currentAssignment ? "Move" : "Assign"} {target.member_name}
        </h2>
        <p className="text-text-secondary mt-1 text-sm">
          {currentAssignment
            ? "Pick a different fixture, or unassign them."
            : "Pick which fixture to put them in."}
        </p>
        <div className="mt-4 space-y-2">
          {fixtures.length === 0 && (
            <p className="bg-border-light text-text-secondary rounded-xl px-4 py-3 text-sm">
              No fixtures on this date.
            </p>
          )}
          {fixtures.map((f) => {
            const isCurrent =
              currentAssignment?.availability_fixture_id === f.id;
            return (
              <button
                key={f.id}
                type="button"
                disabled={pending || isCurrent}
                onClick={() => onAssign(f.id)}
                className={cn(
                  "border-border bg-surface flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left disabled:opacity-60",
                  isCurrent && "border-info bg-info-bg",
                )}
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
                  {isCurrent ? "Current" : `${f.assignments.length} / 11`}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          {currentAssignment && (
            <Button tone="destructive" disabled={pending} onClick={onUnassign}>
              Unassign
            </Button>
          )}
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
