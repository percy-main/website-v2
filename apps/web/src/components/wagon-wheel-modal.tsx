import { Dialog, DialogContent } from "@/components/ui/dialog.js";
import {
  polar,
  ROPE,
  shotRadius,
  VIEW,
} from "@/components/wagon-wheel-geometry.js";
import {
  type Ball,
  COLORS,
  CRICKET_BLOCK_PANEL_CLASSES,
  playerOptions,
  runColor,
} from "@/components/wagon-wheel-shared.js";
import { CumulativeChart } from "@/components/worm-chart.js";
import {
  hasBallByBall,
  useWagonWheelQuery,
  type WagonWheelData,
} from "@/hooks/use-wagon-wheel.js";
import { useMemo, useState } from "react";

interface WagonWheelModalProps {
  matchId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inningsTeamNames?: string[];
}

export function WagonWheelModal({
  matchId,
  open,
  onOpenChange,
  inningsTeamNames,
}: WagonWheelModalProps) {
  const { data, isLoading, isError } = useWagonWheelQuery(matchId, open);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="wagon-wheel-surface h-screen max-h-screen w-screen max-w-none rounded-none border-0 bg-stone-950 p-0 text-stone-100">
        <div className="flex h-full flex-col">
          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            {isLoading && <LoadingState />}
            {isError && <ErrorState />}
            {!isLoading && !isError && !hasBallByBall(data) && <EmptyState />}
            {!isLoading && !isError && hasBallByBall(data) && data && (
              <WagonWheelViewer
                data={data}
                inningsTeamNames={inningsTeamNames}
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Inline, non-modal wagon wheel for embedding in editorial content. Renders
 * the same interactive viewer inside a self-contained dark panel. The author's
 * configuration (innings/batter/bowler) seeds the initial view; readers can
 * still switch innings and change the filters. The `key` on the viewer remounts
 * it when that configuration changes, so the editor preview tracks edits.
 */
export function WagonWheel({
  matchId,
  inningsNumber,
  batterRvId,
  bowlerRvId,
  inningsTeamNames,
}: {
  matchId: string;
  inningsNumber?: number;
  batterRvId?: number;
  bowlerRvId?: number;
  inningsTeamNames?: string[];
}) {
  const { data, isLoading, isError } = useWagonWheelQuery(matchId);
  const configKey = `${String(inningsNumber ?? "")}-${String(batterRvId ?? "")}-${String(bowlerRvId ?? "")}`;

  return (
    <div className={CRICKET_BLOCK_PANEL_CLASSES}>
      {isLoading && <LoadingState />}
      {isError && <ErrorState />}
      {!isLoading && !isError && !hasBallByBall(data) && <EmptyState />}
      {!isLoading && !isError && hasBallByBall(data) && data && (
        <WagonWheelViewer
          key={configKey}
          data={data}
          inningsTeamNames={inningsTeamNames}
          initialInningsNumber={inningsNumber}
          initialBatterRvId={batterRvId}
          initialBowlerRvId={bowlerRvId}
        />
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-6 w-48 animate-pulse rounded bg-stone-800" />
      <div className="aspect-square w-full max-w-[600px] animate-pulse self-center rounded-full bg-stone-800" />
    </div>
  );
}

function ErrorState() {
  return (
    <div className="rounded-md border border-red-900 bg-red-950/40 p-4 text-sm text-red-200">
      Couldn&apos;t load ball-by-ball data. Please try again.
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <svg
        viewBox="0 0 64 64"
        className="size-16 text-stone-700"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="32" cy="32" r="28" />
        <circle cx="32" cy="32" r="14" strokeDasharray="2 3" />
        <line x1="32" y1="32" x2="32" y2="6" />
      </svg>
      <p className="text-base font-medium text-stone-200">
        No ball-by-ball data
      </p>
      <p className="max-w-sm text-sm text-stone-400">
        Ball-by-ball tracking isn&apos;t available for this match. It needs a
        live-scored Play Cricket fixture.
      </p>
    </div>
  );
}

// --- Viewer ---

interface ViewerProps {
  data: WagonWheelData;
  inningsTeamNames?: string[];
  // Author-configured initial view (the wagon wheel content block). The
  // innings selects the starting tab; batter/bowler seed that innings' filter.
  initialInningsNumber?: number;
  initialBatterRvId?: number;
  initialBowlerRvId?: number;
}

function WagonWheelViewer({
  data,
  inningsTeamNames,
  initialInningsNumber,
  initialBatterRvId,
  initialBowlerRvId,
}: ViewerProps) {
  const inningsWithBalls = useMemo(
    () => data.innings.filter((inn) => inn.balls.length > 0),
    [data.innings],
  );

  const initialIndex = useMemo(() => {
    if (initialInningsNumber == null) return 0;
    const i = inningsWithBalls.findIndex(
      (inn) => inn.inningsNumber === initialInningsNumber,
    );
    return i >= 0 ? i : 0;
  }, [inningsWithBalls, initialInningsNumber]);

  const [inningsIndex, setInningsIndex] = useState(initialIndex);
  const active = inningsWithBalls[inningsIndex];
  if (!active) return <EmptyState />;

  const otherInnings = inningsWithBalls.find((_, i) => i !== inningsIndex);
  // Seed the batter/bowler filter only on the author's chosen innings; once a
  // reader switches tabs the new innings starts unfiltered.
  const isInitialInnings = inningsIndex === initialIndex;

  return (
    <div className="flex flex-col gap-4">
      {inningsWithBalls.length > 1 && (
        <div className="flex gap-2" role="tablist" aria-label="Select innings">
          {inningsWithBalls.map((inn, idx) => {
            const name =
              inningsTeamNames?.[inn.inningsNumber - 1] ??
              `Innings ${inn.inningsNumber}`;
            const isActive = idx === inningsIndex;
            return (
              <button
                key={inn.inningsNumber}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setInningsIndex(idx)}
                className={
                  "rounded-md border px-3 py-1.5 text-sm transition-colors " +
                  (isActive
                    ? "border-stone-600 bg-stone-800 text-stone-50"
                    : "border-stone-800 bg-stone-900 text-stone-400 hover:border-stone-700 hover:text-stone-200")
                }
              >
                {name}
              </button>
            );
          })}
        </div>
      )}

      {/* Keyed so per-innings state (filter, hover) resets on tab change. */}
      <InningsView
        key={inningsIndex}
        balls={active.balls}
        otherBalls={otherInnings?.balls}
        dismissalPenalty={data.dismissalPenalty}
        initialBatterRvId={isInitialInnings ? initialBatterRvId : undefined}
        initialBowlerRvId={isInitialInnings ? initialBowlerRvId : undefined}
      />
    </div>
  );
}

function InningsView({
  balls,
  otherBalls,
  dismissalPenalty,
  initialBatterRvId,
  initialBowlerRvId,
}: {
  balls: Ball[];
  otherBalls?: Ball[];
  dismissalPenalty: number;
  initialBatterRvId?: number;
  initialBowlerRvId?: number;
}) {
  const [selectedOver, setSelectedOver] = useState<number | null>(null);
  const [selectedBatter, setSelectedBatter] = useState<number | null>(
    initialBatterRvId ?? null,
  );
  const [selectedBowler, setSelectedBowler] = useState<number | null>(
    initialBowlerRvId ?? null,
  );
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const batters = useMemo(() => playerOptions(balls, "bat"), [balls]);
  const bowlers = useMemo(() => playerOptions(balls, "bowl"), [balls]);

  // Shot directions are optional per-ball scorer input — a match can be
  // fully ball-by-ball scored with none recorded. Decided per innings: one
  // side's scorer may have tracked shots while the other's didn't.
  const inningsHasShotData = balls.some((b) => b.shotAngle !== null);

  const filtered = useMemo(
    () =>
      balls.filter(
        (b) =>
          (selectedOver === null || b.over === selectedOver) &&
          (selectedBatter === null || b.batterRvId === selectedBatter) &&
          (selectedBowler === null || b.bowlerRvId === selectedBowler),
      ),
    [balls, selectedOver, selectedBatter, selectedBowler],
  );

  const stats = computeStats(
    filtered,
    dismissalPenalty,
    selectedBatter !== null,
  );

  return (
    <>
      <CumulativeChart
        balls={balls}
        otherBalls={otherBalls}
        dismissalPenalty={dismissalPenalty}
      />
      <OverFilter
        balls={balls}
        selectedOver={selectedOver}
        onSelect={(o) => setSelectedOver((prev) => (prev === o ? null : o))}
        onClear={() => setSelectedOver(null)}
      />
      <PlayerFilter
        batters={batters}
        bowlers={bowlers}
        selectedBatter={selectedBatter}
        selectedBowler={selectedBowler}
        onBatter={setSelectedBatter}
        onBowler={setSelectedBowler}
      />
      {inningsHasShotData ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_minmax(280px,_320px)]">
          <Wheel
            activeBalls={filtered}
            allBalls={balls}
            hoveredKey={hoveredKey}
            onHover={setHoveredKey}
          />
          <div className="flex flex-col gap-3">
            <StatsGrid stats={stats} />
            <Legend />
            <BallList
              balls={filtered}
              selectedOver={selectedOver}
              onHover={setHoveredKey}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <NoShotDataNote />
          <StatsGrid stats={stats} />
          <Legend />
          <BallList
            balls={filtered}
            selectedOver={selectedOver}
            onHover={setHoveredKey}
          />
        </div>
      )}
    </>
  );
}

/**
 * Shown in place of the wheel when an innings was scored ball-by-ball but
 * the scorer never logged shot directions — the worm chart, stats and
 * commentary above/below are still fully populated.
 */
function NoShotDataNote() {
  return (
    <div className="flex items-center gap-3 rounded-md border border-stone-800 bg-stone-900 p-3">
      <svg
        viewBox="0 0 64 64"
        className="size-8 shrink-0 text-stone-700"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <circle cx="32" cy="32" r="28" />
        <circle cx="32" cy="32" r="14" strokeDasharray="2 3" />
        <line x1="32" y1="32" x2="32" y2="6" />
      </svg>
      <div>
        <p className="text-sm font-medium text-stone-200">No shot data</p>
        <p className="text-xs text-stone-400">
          The scorer didn&apos;t record shot directions for this innings, so
          there&apos;s no wagon wheel to draw.
        </p>
      </div>
    </div>
  );
}

// --- Player filter (batter / bowler) ---

function PlayerFilter({
  batters,
  bowlers,
  selectedBatter,
  selectedBowler,
  onBatter,
  onBowler,
}: {
  batters: Array<{ id: number; name: string }>;
  bowlers: Array<{ id: number; name: string }>;
  selectedBatter: number | null;
  selectedBowler: number | null;
  onBatter: (id: number | null) => void;
  onBowler: (id: number | null) => void;
}) {
  if (batters.length === 0 && bowlers.length === 0) return null;
  const hasFilter = selectedBatter !== null || selectedBowler !== null;
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md border border-stone-800 bg-stone-900 p-3">
      <PlayerSelect
        label="Batter"
        options={batters}
        value={selectedBatter}
        onChange={onBatter}
      />
      <PlayerSelect
        label="Bowler"
        options={bowlers}
        value={selectedBowler}
        onChange={onBowler}
      />
      <button
        type="button"
        onClick={() => {
          onBatter(null);
          onBowler(null);
        }}
        disabled={!hasFilter}
        className="rounded border border-stone-800 px-2 py-1.5 text-xs text-stone-300 transition-colors hover:border-stone-700 disabled:cursor-default disabled:opacity-40 disabled:hover:border-stone-800"
      >
        Clear players
      </button>
    </div>
  );
}

function PlayerSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ id: number; name: string }>;
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold tracking-wider text-stone-500 uppercase">
        {label}
      </span>
      <select
        value={value ?? ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : Number(e.target.value))
        }
        disabled={options.length === 0}
        className="min-w-[10rem] rounded-md border border-stone-700 bg-stone-800 px-2 py-1.5 text-sm text-stone-100 transition-colors hover:border-stone-600 focus:border-stone-500 focus:outline-none disabled:opacity-40"
      >
        <option value="">All {label.toLowerCase()}s</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

// --- Stats / Legend ---

interface Stats {
  runs: number;
  balls: number;
  boundaries: number;
  wickets: number;
}

function computeStats(
  balls: Ball[],
  dismissalPenalty: number,
  batterSelected: boolean,
): Stats {
  const wickets = balls.filter((b) => b.dismissed).length;
  // With a single batter filtered, "Runs" is that batter's own score (off the
  // bat only) so it matches the scorecard. Otherwise it's the total runs on
  // these balls, including extras (the innings / over / bowler views).
  const gross = balls.reduce(
    (a, b) => a + b.runsBat + (batterSelected ? 0 : b.runsExtra),
    0,
  );
  return {
    runs: gross - wickets * dismissalPenalty,
    balls: balls.length,
    boundaries: balls.filter((b) => b.runsBat === 4 || b.runsBat === 6).length,
    wickets,
  };
}

function StatsGrid({ stats }: { stats: Stats }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <StatCell label="Runs" value={stats.runs} />
      <StatCell label="Balls" value={stats.balls} />
      <StatCell label="Boundaries" value={stats.boundaries} />
      <StatCell label="Wkts" value={stats.wickets} />
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-stone-800 bg-stone-900 px-2 py-1.5">
      <div className="text-[10px] font-semibold tracking-wider text-stone-500 uppercase">
        {label}
      </div>
      <div className="font-mono text-lg font-semibold tabular-nums">
        {value}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-400">
      <LegendItem color={COLORS.dot} label="dot" />
      <LegendItem color={COLORS.r1} label="1-3" />
      <LegendItem color={COLORS.r4} label="4" />
      <LegendItem color={COLORS.r6} label="6" />
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block size-2 rounded-full"
          style={{ backgroundColor: COLORS.wkt }}
        />
        wicket
      </span>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block h-0.5 w-3 rounded"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

// --- Over-by-over filter (collapsible) ---

interface OverAgg {
  over: number;
  runs: number;
  wickets: number;
  balls: Ball[];
}

function aggregateOvers(balls: Ball[]): OverAgg[] {
  const byOver = new Map<number, OverAgg>();
  for (const b of balls) {
    let agg = byOver.get(b.over);
    if (!agg) {
      agg = { over: b.over, runs: 0, wickets: 0, balls: [] };
      byOver.set(b.over, agg);
    }
    agg.balls.push(b);
    agg.runs += b.runsBat + b.runsExtra;
    if (b.dismissed) agg.wickets += 1;
  }
  return Array.from(byOver.values()).sort((a, b) => a.over - b.over);
}

function OverFilter({
  balls,
  selectedOver,
  onSelect,
  onClear,
}: {
  balls: Ball[];
  selectedOver: number | null;
  onSelect: (over: number) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const overs = useMemo(() => aggregateOvers(balls), [balls]);
  const maxBallRuns = useMemo(() => {
    let m = 1;
    for (const o of overs) {
      for (const b of o.balls) {
        const r = b.runsBat + b.runsExtra;
        if (r > m) m = r;
      }
    }
    return m;
  }, [overs]);

  if (overs.length === 0) return null;

  return (
    <div className="rounded-md border border-stone-800 bg-stone-900">
      <div className="flex items-center justify-between gap-2 p-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-2 text-[10px] font-semibold tracking-wider text-stone-400 uppercase transition-colors hover:text-stone-200"
        >
          <svg
            viewBox="0 0 12 12"
            className={
              "size-3 transition-transform " + (open ? "rotate-90" : "")
            }
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path
              d="M4 2l4 4-4 4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Over by over
          {selectedOver !== null && (
            <span className="rounded bg-stone-800 px-1.5 py-0.5 text-stone-200 normal-case">
              Over {selectedOver + 1}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={selectedOver === null}
          className="rounded border border-stone-800 px-2 py-0.5 text-xs text-stone-300 transition-colors hover:border-stone-700 disabled:cursor-default disabled:opacity-40 disabled:hover:border-stone-800"
        >
          Clear filter
        </button>
      </div>
      {open && (
        <div className="px-3 pb-3">
          <p className="mb-2 text-xs text-stone-500">
            Tap an over to filter the balls shown.
          </p>
          {/* Wrap into a responsive grid rather than a single horizontally
              scrolling row. A long innings (40+ overs) overflowed an invisible
              horizontal scrollbar inside the vertically scrolling modal, leaving
              later overs unreachable on a laptop. auto-fill keeps cells uniform
              and every over visible/tappable at any width. */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(60px,1fr))] gap-1">
            {overs.map((o) => {
              const isSelected = selectedOver === o.over;
              return (
                <button
                  key={o.over}
                  type="button"
                  onClick={() => onSelect(o.over)}
                  className={
                    "flex flex-col items-center rounded-md px-2 py-1 transition-colors " +
                    (isSelected
                      ? "bg-stone-800 outline outline-stone-600"
                      : "hover:bg-stone-800/60")
                  }
                  aria-pressed={isSelected}
                  aria-label={`Over ${o.over + 1}, ${o.runs} runs${o.wickets ? `, ${o.wickets} wicket${o.wickets === 1 ? "" : "s"}` : ""}`}
                >
                  <div className="flex h-12 items-end gap-px">
                    {o.balls.map((b) => {
                      const r = b.runsBat + b.runsExtra;
                      const h = 4 + (r / Math.max(1, maxBallRuns)) * 44;
                      return (
                        <span
                          key={`${b.over}-${b.ball}`}
                          style={{
                            height: `${h}px`,
                            backgroundColor: runColor(b),
                            outline: b.dismissed
                              ? `1.5px solid ${COLORS.wkt}`
                              : undefined,
                          }}
                          className="w-1.5 rounded-sm"
                          title={b.lDesc || b.sDesc}
                        />
                      );
                    })}
                  </div>
                  <div className="mt-1 font-mono text-xs font-semibold tabular-nums">
                    {o.runs}
                    {o.wickets > 0 && (
                      <span
                        className="ml-0.5"
                        style={{ color: COLORS.wkt }}
                      >{`·${o.wickets}`}</span>
                    )}
                  </div>
                  <div className="font-mono text-[10px] text-stone-500 tabular-nums">
                    {o.over + 1}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Wheel ---

function ballKey(b: Pick<Ball, "over" | "ball">): string {
  return `${b.over}-${b.ball}`;
}

interface WheelProps {
  activeBalls: Ball[];
  allBalls: Ball[];
  hoveredKey: string | null;
  onHover: (key: string | null) => void;
}

function Wheel({ activeBalls, allBalls, hoveredKey, onHover }: WheelProps) {
  const activeKeys = useMemo(
    () => new Set(activeBalls.map(ballKey)),
    [activeBalls],
  );
  const [tipBall, setTipBall] = useState<Ball | null>(null);

  const handleEnter = (b: Ball) => {
    setTipBall(b);
    onHover(ballKey(b));
  };
  const handleLeave = () => {
    setTipBall(null);
    onHover(null);
  };

  // Tooltip anchored to the shot endpoint, expressed as % of container.
  // Anchor from `right` when near the right edge — using `left: 100%` would
  // give the absolute box zero available width and the browser shrink-wraps
  // it to min-content before the transform runs.
  let tipStyle: React.CSSProperties | null = null;
  if (tipBall?.shotAngle != null) {
    const [sx, sy] = polar(tipBall.shotAngle, shotRadius(tipBall));
    const pctX = ((sx + VIEW) / (VIEW * 2)) * 100;
    const pctY = ((sy + VIEW) / (VIEW * 2)) * 100;
    const onRight = pctX > 60;
    tipStyle = onRight
      ? {
          right: `${100 - pctX}%`,
          top: `${pctY}%`,
          transform: "translate(-8px, 8px)",
        }
      : {
          left: `${pctX}%`,
          top: `${pctY}%`,
          transform: "translate(8px, 8px)",
        };
  }

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[600px]">
      {/* No role="img": that would strip the focusable shot markers below
          from the accessibility tree. <title> still provides the name. */}
      <svg
        viewBox={`-${VIEW} -${VIEW} ${VIEW * 2} ${VIEW * 2}`}
        className="block h-full w-full touch-none"
      >
        <title>Wagon wheel — shot directions plotted from the wicket</title>
        <defs>
          <radialGradient id="ww-grass" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#244a2b" />
            <stop offset="100%" stopColor="#1d3b22" />
          </radialGradient>
        </defs>
        <circle
          cx={0}
          cy={0}
          r={ROPE}
          fill="url(#ww-grass)"
          stroke="#3a6f45"
          strokeWidth={2}
        />
        <circle
          cx={0}
          cy={0}
          r={120}
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeDasharray="3 4"
        />
        <rect
          x={-10}
          y={-20}
          width={20}
          height={110}
          rx={2}
          fill="#c8b384"
          opacity={0.5}
        />

        <DirectionLabels />

        {/* Ghost layer — balls not in the active filter */}
        {allBalls.map((b) => {
          if (b.shotAngle == null) return null;
          if (activeKeys.has(ballKey(b))) return null;
          const [x, y] = polar(b.shotAngle, shotRadius(b));
          return (
            <line
              key={`g-${ballKey(b)}`}
              x1={0}
              y1={0}
              x2={x}
              y2={y}
              stroke="#2a2f3d"
              strokeWidth={1}
              opacity={0.55}
            />
          );
        })}

        {/* Dismissal rings */}
        {activeBalls.map((b) => {
          if (!b.dismissed || b.shotAngle == null) return null;
          const [x, y] = polar(b.shotAngle, shotRadius(b));
          return (
            <circle
              key={`w-${ballKey(b)}`}
              cx={x}
              cy={y}
              r={7}
              fill="none"
              stroke={COLORS.wkt}
              strokeWidth={2}
            />
          );
        })}

        {/* Active shots */}
        {activeBalls.map((b) => {
          if (b.shotAngle == null) return null;
          const [x, y] = polar(b.shotAngle, shotRadius(b));
          const isHover = hoveredKey === ballKey(b);
          const color = runColor(b);
          return (
            <g
              key={`a-${ballKey(b)}`}
              onMouseEnter={() => handleEnter(b)}
              onMouseLeave={handleLeave}
              onFocus={() => handleEnter(b)}
              onBlur={handleLeave}
              tabIndex={0}
              aria-label={`Over ${b.over}: ${b.runsBat} ${b.runsBat === 1 ? "run" : "runs"}${b.dismissed ? ", wicket" : ""}`}
              style={{ cursor: "pointer" }}
            >
              <line
                x1={0}
                y1={0}
                x2={x}
                y2={y}
                stroke={color}
                strokeWidth={isHover ? 3 : b.runsBat >= 4 ? 2.4 : 1.6}
                strokeLinecap="round"
                opacity={b.runsBat === 0 ? 0.6 : 0.9}
              />
              <circle
                cx={x}
                cy={y}
                r={isHover ? 5 : b.runsBat >= 4 ? 3.5 : 2.2}
                fill={color}
              />
              {/* Bigger invisible hit area for touch */}
              <line
                x1={0}
                y1={0}
                x2={x}
                y2={y}
                stroke="transparent"
                strokeWidth={14}
              />
            </g>
          );
        })}

        <circle cx={0} cy={0} r={3.5} fill="#e7ecf3" />
      </svg>

      {tipBall && tipStyle && <Tooltip style={tipStyle} ball={tipBall} />}
    </div>
  );
}

function DirectionLabels() {
  const labels: Array<[string, number]> = [
    ["Legside", 90],
    ["Offside", 270],
  ];
  return (
    <g>
      {labels.map(([text, ang]) => {
        const [x, y] = polar(ang, 232);
        return (
          <text
            key={text}
            x={x}
            y={y}
            fill="#8a93a4"
            fontSize={10}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {text}
          </text>
        );
      })}
    </g>
  );
}

function Tooltip({ style, ball }: { style: React.CSSProperties; ball: Ball }) {
  const runLbl = ball.runsBat === 1 ? "1 run" : `${ball.runsBat} runs`;
  // Fall back to the batter parsed from lDesc when batterName is null (no PC
  // mapping), rather than showing "#-101". See dismissalText / playerOptions.
  const parsed = /^\s*(.+?)\s+to\s+(.+?):/.exec(ball.lDesc);
  const batter = ball.batterName ?? parsed?.[2] ?? `#${ball.batterRvId ?? "?"}`;
  return (
    <div
      className="pointer-events-none absolute z-10 max-w-[240px] rounded-md border border-stone-800 bg-stone-950/95 px-2 py-1.5 text-xs text-stone-100 shadow-lg"
      style={style}
    >
      <div className="font-semibold">
        {ball.over}.{ball.ballDisp} • {batter} • {runLbl}
        {ball.dismissed ? " • W" : ""}
      </div>
      <div className="mt-0.5 text-[11px] text-stone-400">
        {ball.lDesc || ball.sDesc}
      </div>
    </div>
  );
}

// --- Ball list ---

function BallList({
  balls,
  selectedOver,
  onHover,
}: {
  balls: Ball[];
  selectedOver: number | null;
  onHover: (key: string | null) => void;
}) {
  const head =
    selectedOver !== null
      ? `Over ${selectedOver + 1} — ${balls.length} ball${balls.length === 1 ? "" : "s"}`
      : `All balls — ${balls.length}`;
  return (
    <div className="rounded-md border border-stone-800 bg-stone-900 p-2">
      <h3 className="mb-1 px-1 text-[10px] font-semibold tracking-wider text-stone-500 uppercase">
        {head}
      </h3>
      <div className="max-h-[260px] overflow-y-auto sm:max-h-[300px]">
        {balls.map((b) => {
          let markText: string;
          let markColor: string;
          let isDot = false;
          if (b.dismissed) {
            markText = "W";
            markColor = COLORS.wkt;
          } else if (b.runsBat === 0) {
            markText = "·";
            markColor = COLORS.dot;
            isDot = true;
          } else {
            markText = String(b.runsBat);
            markColor = runColor(b);
          }
          return (
            <div
              key={ballKey(b)}
              onMouseEnter={() => onHover(ballKey(b))}
              onMouseLeave={() => onHover(null)}
              className="flex items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-stone-800"
            >
              <span className="w-9 font-mono text-stone-500 tabular-nums">
                {b.over}.{b.ballDisp}
              </span>
              <span
                style={{
                  color: markColor,
                  fontSize: isDot ? "14px" : "11px",
                  lineHeight: isDot ? 0.6 : 1,
                }}
                className="w-4 text-center font-mono font-semibold tabular-nums"
              >
                {markText}
              </span>
              <span className="flex-1 truncate text-stone-200">
                {b.lDesc || b.sDesc}
              </span>
            </div>
          );
        })}
        {balls.length === 0 && (
          <div className="px-1 py-2 text-xs text-stone-500">
            No balls in this selection.
          </div>
        )}
      </div>
    </div>
  );
}
