import { StatusPill } from "@/components/primitives/status-pill.js";
import { Button } from "@/components/ui/button.js";
import { fmtDate } from "@/features/format.js";
import { api, callApi, type ApiResponse } from "@/lib/api-client.js";
import { useQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { Link } from "react-router";

type RequestRow =
  ApiResponse<"/api/availability/requests">["items"][number];

/**
 * Phase 3 official-side availability list.
 *
 * Reads `GET /api/availability/requests`. Each card shows date range,
 * fixture count, response progress, and Manage / Nudge actions. Tap to
 * open the per-request detail.
 */
export default function OfficialAvailability() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["availability", "requests"],
    queryFn: () =>
      callApi(
        api.GET("/api/availability/requests", {
          params: { query: { limit: 30 } },
        }),
      ),
  });
  const items = data?.items ?? [];
  const open = items.filter((r) => r.status === "open");
  const closed = items.filter((r) => r.status !== "open");
  return (
    <div className="mx-auto w-full max-w-2xl pb-6">
      <header className="flex items-center justify-between px-4 pb-2 pt-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
            Availability
          </p>
          <h1 className="text-2xl font-semibold tracking-[-0.015em]">
            Requests
          </h1>
        </div>
        <Button asChild tone="primary" size="sm">
          <Link to="/official/availability/new">
            <PlusIcon className="size-4" />
            New
          </Link>
        </Button>
      </header>

      {isLoading && <Skel />}
      {isError && (
        <p className="px-4 py-6 text-sm text-text-secondary">
          Couldn't load availability requests.
        </p>
      )}
      {!isLoading && !isError && (
        <>
          {open.length === 0 ? (
            <Empty />
          ) : (
            <Section title="Open" items={open} />
          )}
          {closed.length > 0 && <Section title="Closed" items={closed} muted />}
        </>
      )}
    </div>
  );
}

function Section({
  title,
  items,
  muted,
}: {
  title: string;
  items: RequestRow[];
  muted?: boolean;
}) {
  return (
    <section className="px-4 pt-4">
      <h2 className="pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
        {title}
      </h2>
      <div className="space-y-2">
        {items.map((r) => (
          <Card key={r.id} r={r} muted={muted} />
        ))}
      </div>
    </section>
  );
}

function Card({ r, muted }: { r: RequestRow; muted?: boolean }) {
  // Expected respondent count isn't returned by the list endpoint —
  // show fixtureCount instead and treat respondentCount as a simple
  // counter. Detail view has full breakdown.
  const isOpen = r.status === "open";
  return (
    <Link
      to={`/official/availability/${r.id}`}
      className={`block rounded-2xl border border-border bg-surface p-4 ${muted ? "opacity-70" : ""}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
            {fmtDate(r.date_from, "d MMM")} – {fmtDate(r.date_to, "d MMM")}
          </p>
          <p className="mt-0.5 text-base font-semibold">
            {r.fixtureCount} fixture{r.fixtureCount === 1 ? "" : "s"}
          </p>
        </div>
        <StatusPill tone={isOpen ? "warning" : "neutral"} dot>
          {isOpen ? "Open" : r.status}
        </StatusPill>
      </div>
      <p className="mt-3 text-xs text-text-secondary">
        {r.respondentCount} response{r.respondentCount === 1 ? "" : "s"}
        {r.created_by_name ? ` · created by ${r.created_by_name}` : ""}
      </p>
    </Link>
  );
}

function Skel() {
  return (
    <div className="space-y-2 px-4 py-4">
      {["a", "b"].map((s) => (
        <div key={s} className="h-24 rounded-2xl bg-border" />
      ))}
    </div>
  );
}

function Empty() {
  return (
    <div className="px-6 py-12 text-center">
      <p className="text-sm font-semibold">No open requests</p>
      <p className="mt-1 text-sm text-text-secondary">
        Create one to ask players for their availability.
      </p>
      <Button asChild tone="primary" className="mt-4 inline-flex">
        <Link to="/official/availability/new">
          <PlusIcon className="size-4" />
          New request
        </Link>
      </Button>
    </div>
  );
}
