import { Button } from "@/components/ui/button.js";
import { fmtDate } from "@/features/format.js";
import { api, callApi, type ApiResponse } from "@/lib/api-client.js";
import { cn } from "@/lib/utils.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  XIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

/**
 * Phase 2 availability response flow.
 *
 * Reads /api/availability/active. The response gives us each active
 * request + the list of fixtures in its date range + the user's
 * existing responses, plus any junior dependents the member can answer
 * for and their existing responses.
 *
 * A parent of juniors answers for several "subjects" - themselves and
 * each dependent (a junior playing up into a senior squad). When they
 * have dependents we open on a subject picker; choosing one walks its
 * unanswered dates one screen at a time, then drops back to the picker
 * with the remaining subjects still selectable. With no dependents the
 * picker is skipped entirely and it behaves as the plain self flow.
 *
 * Per the plan: tap-not-swipe, both available/unavailable buttons on
 * the same screen, optional note, end-state celebration. The selected
 * subject lives in the URL (`?for=`) so it survives reloads and back.
 */

type ActiveResponse = ApiResponse<"/api/availability/active">;
type ActiveItem = ActiveResponse["items"][number];
type Fixture = ActiveItem["fixtures"][number];

interface Step {
  requestId: string;
  date: string;
  fixtures: Fixture[];
}

interface Subject {
  // "self" for the member, otherwise the dependent's id. Also the value
  // carried in the `?for=` search param.
  key: string;
  name: string;
  dependentId: string | null;
  // Unanswered (request, date) pairs for this subject.
  steps: Step[];
  answeredCount: number;
  // Total answerable dates across open requests (uniform across
  // subjects - everyone shares the same fixture dates).
  totalCount: number;
}

const SELF_KEY = "self";

function datesByRequest(openItems: ActiveItem[]) {
  // Per request: the unique match_dates and their fixtures. Shared by
  // every subject, so compute once.
  return openItems.map((item) => {
    const byDate = new Map<string, Fixture[]>();
    for (const f of item.fixtures) {
      const list = byDate.get(f.match_date) ?? [];
      list.push(f);
      byDate.set(f.match_date, list);
    }
    return { requestId: item.id, byDate };
  });
}

function subjectFrom(
  key: string,
  name: string,
  dependentId: string | null,
  perRequest: ReturnType<typeof datesByRequest>,
  answeredByRequest: Map<string, Set<string>>,
): Subject {
  const steps: Step[] = [];
  let answeredCount = 0;
  let totalCount = 0;
  for (const { requestId, byDate } of perRequest) {
    const answered = answeredByRequest.get(requestId) ?? new Set<string>();
    for (const [date, fixtures] of byDate) {
      totalCount += 1;
      if (answered.has(date)) {
        answeredCount += 1;
      } else {
        steps.push({ requestId, date, fixtures });
      }
    }
  }
  steps.sort((a, b) => a.date.localeCompare(b.date));
  return { key, name, dependentId, steps, answeredCount, totalCount };
}

function buildSubjects(data: ActiveResponse | undefined): Subject[] {
  if (!data) return [];
  const openItems = data.items.filter((i) => i.status === "open");
  const perRequest = datesByRequest(openItems);
  const subjects: Subject[] = [];

  if (data.memberId) {
    const answeredByRequest = new Map<string, Set<string>>();
    for (const item of openItems) {
      answeredByRequest.set(
        item.id,
        new Set(item.myResponses.map((r) => r.match_date)),
      );
    }
    subjects.push(
      subjectFrom(SELF_KEY, "You", null, perRequest, answeredByRequest),
    );
  }

  for (const dep of data.dependents) {
    const answeredByRequest = new Map<string, Set<string>>();
    for (const item of openItems) {
      answeredByRequest.set(
        item.id,
        new Set(
          item.dependentResponses
            .filter((r) => r.dependent_id === dep.id)
            .map((r) => r.match_date),
        ),
      );
    }
    subjects.push(
      subjectFrom(dep.id, dep.name, dep.id, perRequest, answeredByRequest),
    );
  }

  return subjects;
}

export default function AvailabilityRespond() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["availability", "active"],
    queryFn: () => callApi(api.GET("/api/availability/active")),
  });

  const subjects = useMemo(() => buildSubjects(data), [data]);

  // Available-so-far counts come back fresh on every refetch (we want
  // these to update as other players answer), so they're keyed off the
  // live `data`.
  const availableCountByKey = useMemo<Map<string, number>>(() => {
    const m = new Map<string, number>();
    for (const item of data?.items ?? []) {
      for (const c of item.availableCounts) {
        m.set(`${item.id}:${c.match_date}`, c.count);
      }
    }
    return m;
  }, [data]);

  if (isLoading) {
    return (
      <FlowFrame>
        <div className="mx-auto w-full max-w-md px-5 py-12">
          <div className="bg-border h-6 w-1/3 rounded-md" />
          <div className="bg-border mt-4 h-32 rounded-2xl" />
          <div className="bg-border mt-4 h-32 rounded-2xl" />
        </div>
      </FlowFrame>
    );
  }
  if (isError) {
    return (
      <FlowFrame>
        <div className="mx-auto max-w-md px-6 py-12 text-center">
          <h1 className="text-lg font-semibold">Couldn't load availability</h1>
          <p className="text-text-secondary mt-2 text-sm">
            Try again in a moment.
          </p>
          <Button asChild tone="outline" className="mt-4 inline-flex">
            <Link to="/">Back to home</Link>
          </Button>
        </div>
      </FlowFrame>
    );
  }

  const totalDates = subjects[0]?.totalCount ?? 0;
  if (totalDates === 0) {
    return (
      <FlowFrame>
        <EmptyDone
          title="You're all caught up"
          body="No open availability requests right now. We'll let you know."
          onBack={() => {
            void navigate("/");
          }}
        />
      </FlowFrame>
    );
  }

  // Only the member's own subject exists -> no picker, straight into the
  // self flow exactly as before.
  const hasDependents = subjects.some((s) => s.dependentId !== null);
  const forParam = searchParams.get("for");
  const selected = hasDependents
    ? subjects.find((s) => s.key === forParam)
    : subjects[0];

  if (!selected) {
    return (
      <FlowFrame>
        <SubjectPicker
          subjects={subjects}
          onSelect={(key) => {
            setSearchParams({ for: key });
          }}
          onBack={() => {
            void navigate("/");
          }}
        />
      </FlowFrame>
    );
  }

  const backToPicker = () => {
    setSearchParams({}, { replace: true });
  };

  return (
    <SubjectStepper
      // Remount when the subject changes so the snapshot + step index
      // reset cleanly for the newly chosen person.
      key={selected.key}
      subject={selected}
      availableCountByKey={availableCountByKey}
      hasPicker={hasDependents}
      onExit={() => {
        if (hasDependents) {
          backToPicker();
        } else {
          void navigate("/");
        }
      }}
    />
  );
}

function SubjectPicker({
  subjects,
  onSelect,
  onBack,
}: {
  subjects: Subject[];
  onSelect: (key: string) => void;
  onBack: () => void;
}) {
  const allDone = subjects.every((s) => s.steps.length === 0);
  return (
    <>
      <header className="border-border flex items-center gap-3 border-b p-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="text-text-secondary hover:bg-surface-raised grid size-9 place-items-center rounded-md"
        >
          <ArrowLeftIcon className="size-5" />
        </button>
        <h1 className="text-base font-semibold">Answer availability</h1>
      </header>
      <div className="mx-auto w-full max-w-md px-5 py-6">
        <p className="text-text-secondary text-sm">
          Who are you answering for?
        </p>
        <ul className="mt-4 space-y-2">
          {subjects.map((s) => {
            const done = s.steps.length === 0;
            return (
              <li key={s.key}>
                <button
                  type="button"
                  disabled={done}
                  onClick={() => onSelect(s.key)}
                  className={cn(
                    "border-border bg-surface-raised flex w-full items-center gap-3 rounded-xl border p-4 text-left",
                    done ? "opacity-70" : "hover:border-navy",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold",
                      done
                        ? "bg-success-bg text-success"
                        : "bg-info-bg text-navy dark:text-white",
                    )}
                  >
                    {done ? (
                      <CheckIcon className="size-5" strokeWidth={2.4} />
                    ) : (
                      initials(s.name)
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {s.key === SELF_KEY ? "Myself" : s.name}
                    </span>
                    <span className="text-text-secondary block text-xs">
                      {done
                        ? "All answered"
                        : `${s.answeredCount} of ${s.totalCount} answered`}
                    </span>
                  </span>
                  {!done && (
                    <ChevronRightIcon className="text-text-secondary size-5 shrink-0" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        {allDone && (
          <div className="mt-6 text-center">
            <p className="text-text-secondary text-sm">
              Everyone's availability is in. Thank you!
            </p>
            <Button tone="primary" className="mt-4 w-full" onClick={onBack}>
              Back to home
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

function SubjectStepper({
  subject,
  availableCountByKey,
  hasPicker,
  onExit,
}: {
  subject: Subject;
  availableCountByKey: Map<string, number>;
  hasPicker: boolean;
  onExit: () => void;
}) {
  const qc = useQueryClient();

  // Snapshot the unanswered steps on entry. We invalidate the
  // availability query after each save so the picker counts stay fresh,
  // but the refetch would otherwise shrink this list under us and bounce
  // to the done screen after the first answer.
  const [flowSteps] = useState<Step[]>(subject.steps);
  const [stepIndex, setStepIndex] = useState(0);
  const [note, setNote] = useState("");

  const respond = useMutation({
    mutationFn: (vars: {
      requestId: string;
      responses: Array<{
        matchDate: string;
        status: "available" | "unavailable";
        note?: string;
      }>;
    }) =>
      callApi(
        api.POST("/api/availability/requests/{requestId}/respond", {
          params: { path: { requestId: vars.requestId } },
          body: {
            ...(subject.dependentId
              ? { subjectDependentId: subject.dependentId }
              : {}),
            responses: vars.responses,
          },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["availability"] });
    },
  });

  const current = flowSteps[stepIndex];
  const total = flowSteps.length;
  const currentAvailableCount = current
    ? (availableCountByKey.get(`${current.requestId}:${current.date}`) ?? 0)
    : 0;

  async function pick(answer: "available" | "unavailable") {
    if (!current) return;
    const noteTrim = note.trim();
    await respond.mutateAsync({
      requestId: current.requestId,
      responses: [
        {
          matchDate: current.date,
          status: answer,
          ...(noteTrim && { note: noteTrim }),
        },
      ],
    });
    setNote("");
    setStepIndex((prev) => prev + 1);
  }

  // Either the subject was already fully answered, or we've just walked
  // its last date.
  if (flowSteps.length === 0 || stepIndex >= flowSteps.length || !current) {
    return (
      <FlowFrame>
        <EmptyDone
          title={
            subject.key === SELF_KEY
              ? "Your availability is in"
              : `${subject.name}'s availability is in`
          }
          body="Nice one."
          onBack={onExit}
          backLabel={hasPicker ? "Choose someone else" : "Back to home"}
          icon="check"
        />
      </FlowFrame>
    );
  }

  return (
    <FlowFrame>
      <header className="border-border flex items-center gap-3 border-b p-3">
        <button
          type="button"
          onClick={onExit}
          aria-label="Back"
          className="text-text-secondary hover:bg-surface-raised grid size-9 place-items-center rounded-md"
        >
          <ArrowLeftIcon className="size-5" />
        </button>
        <div className="flex flex-1 gap-1.5">
          {flowSteps.map((s, i) => (
            <span
              key={`${s.requestId}:${s.date}`}
              className={cn(
                "h-1 flex-1 rounded-full",
                i < stepIndex
                  ? "bg-success"
                  : i === stepIndex
                    ? "bg-navy"
                    : "bg-border",
              )}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={onExit}
          className="text-text-secondary text-xs font-medium"
        >
          Done
        </button>
      </header>
      <div className="mx-auto w-full max-w-md px-5 py-6">
        <div className="flex items-baseline justify-between">
          <span className="text-text-secondary text-[11px] font-semibold tracking-[0.06em] uppercase">
            Answering for {subject.key === SELF_KEY ? "yourself" : subject.name}
          </span>
          <span className="text-text-secondary text-xs">
            {stepIndex + 1} of {total}
          </span>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-[-0.015em]">
          {fmtDate(current.date, "EEEE d MMMM")}
        </h1>

        <div className="mt-4 space-y-2">
          {current.fixtures.map((f) => (
            <div
              key={f.id}
              className="border-border bg-surface-raised rounded-xl border p-3"
            >
              <div className="flex items-center justify-between">
                <strong className="text-sm">
                  {[f.team_name, "vs", f.opposition].filter(Boolean).join(" ")}
                </strong>
                {f.competition_name && (
                  <span className="text-text-secondary text-[11px] font-semibold tracking-wider uppercase">
                    {f.competition_name}
                  </span>
                )}
              </div>
              <div className="text-text-secondary mt-1 text-xs">
                {[f.is_home ? "Home" : "Away", f.match_time]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
          ))}
        </div>

        <p className="text-text-secondary mt-3 text-xs">
          {currentAvailableCount}{" "}
          {currentAvailableCount === 1 ? "player is" : "players are"} available
          so far
        </p>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={respond.isPending}
            onClick={() => {
              void pick("available");
            }}
            className="border-success/15 bg-success-bg text-success flex h-32 flex-col items-center justify-center gap-2 rounded-2xl border-2 text-lg font-bold disabled:opacity-60"
          >
            <CheckIcon className="size-8" strokeWidth={2.4} />
            Available
          </button>
          <button
            type="button"
            disabled={respond.isPending}
            onClick={() => {
              void pick("unavailable");
            }}
            className="border-danger/15 bg-danger-bg text-danger flex h-32 flex-col items-center justify-center gap-2 rounded-2xl border-2 text-lg font-bold disabled:opacity-60"
          >
            <XIcon className="size-8" strokeWidth={2.4} />
            Unavailable
          </button>
        </div>

        <div className="border-border bg-surface mt-4 rounded-xl border px-4 py-3">
          <label
            htmlFor="note"
            className="text-text-secondary text-[11px] font-semibold tracking-[0.06em] uppercase"
          >
            Optional note
          </label>
          <input
            id="note"
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
            placeholder="e.g. free after 1pm"
            className="placeholder:text-text-muted mt-1 w-full bg-transparent text-sm outline-none"
          />
        </div>

        {respond.isError && (
          <p className="text-danger mt-4 flex items-center gap-1.5 text-sm">
            <CircleAlertIcon className="size-4" />
            Couldn't save, try again.
          </p>
        )}
      </div>
    </FlowFrame>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

function EmptyDone({
  title,
  body,
  onBack,
  backLabel,
  icon,
}: {
  title: string;
  body: string;
  onBack: () => void;
  backLabel?: string;
  icon?: "check";
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center px-6 py-20 text-center">
      <div
        className={cn(
          "grid size-20 place-items-center rounded-full",
          icon === "check"
            ? "bg-success-bg text-success"
            : "bg-border text-text-secondary",
        )}
      >
        <CheckIcon className="size-10" strokeWidth={2.4} />
      </div>
      <h1 className="mt-5 text-2xl font-semibold tracking-[-0.015em]">
        {title}
      </h1>
      <p className="text-text-secondary mt-1 text-sm">{body}</p>
      <Button tone="primary" className="mt-6 w-full max-w-xs" onClick={onBack}>
        {backLabel ?? "Back to home"}
      </Button>
    </div>
  );
}

function FlowFrame({ children }: { children: React.ReactNode }) {
  return <div className="bg-surface flex min-h-full flex-col">{children}</div>;
}
