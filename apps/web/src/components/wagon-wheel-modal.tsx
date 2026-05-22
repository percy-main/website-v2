import { Dialog, DialogContent } from "@/components/ui/dialog.js";
import { api, callApi } from "@/lib/api-client.js";
import type { paths } from "@/lib/api.gen.js";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

type WagonWheelData =
  paths["/api/games/{matchId}/wagon-wheel"]["get"]["responses"]["200"]["content"]["application/json"];

type Ball = WagonWheelData["innings"][number]["balls"][number];

const STALE_TIME = 5 * 60 * 1000;

export function useWagonWheelQuery(matchId: string, enabled = true) {
  return useQuery({
    queryKey: ["wagon-wheel", matchId],
    queryFn: () =>
      callApi(
        api.GET("/api/games/{matchId}/wagon-wheel", {
          params: { path: { matchId } },
        }),
      ),
    enabled: !!matchId && enabled,
    staleTime: STALE_TIME,
  });
}

export function hasWagonWheel(data: WagonWheelData | undefined): boolean {
  // Require at least one ball with a recorded shot direction — otherwise
  // the viewer would open onto an empty wheel even though the API
  // technically returned ball-by-ball rows.
  return (
    !!data &&
    data.innings.some((inn) =>
      inn.balls.some((b) => b.shotAngle !== null),
    )
  );
}

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
      <DialogContent className="h-screen max-h-screen w-screen max-w-none rounded-none border-0 bg-stone-950 p-0 text-stone-100">
        <div className="flex h-full flex-col">
          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            {isLoading && <LoadingState />}
            {isError && <ErrorState />}
            {!isLoading && !isError && !hasWagonWheel(data) && <EmptyState />}
            {!isLoading && !isError && hasWagonWheel(data) && data && (
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
        No wagon wheel data
      </p>
      <p className="max-w-sm text-sm text-stone-400">
        Ball-by-ball shot tracking isn&apos;t available for this match. It needs
        a live-scored Play Cricket fixture where the scorer logged shot
        directions.
      </p>
    </div>
  );
}

// --- Viewer ---

interface ViewerProps {
  data: WagonWheelData;
  inningsTeamNames?: string[];
}

function WagonWheelViewer({ data, inningsTeamNames }: ViewerProps) {
  const inningsWithBalls = useMemo(
    () => data.innings.filter((inn) => inn.balls.length > 0),
    [data.innings],
  );

  const [inningsIndex, setInningsIndex] = useState(0);
  const active = inningsWithBalls[inningsIndex];
  if (!active) return <EmptyState />;

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
        otherBalls={inningsWithBalls.find((_, i) => i !== inningsIndex)?.balls}
        dismissalPenalty={data.dismissalPenalty}
      />
    </div>
  );
}

function InningsView({
  balls,
  otherBalls,
  dismissalPenalty,
}: {
  balls: Ball[];
  otherBalls?: Ball[];
  dismissalPenalty: number;
}) {
  const [selectedOver, setSelectedOver] = useState<number | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const filtered =
    selectedOver === null
      ? balls
      : balls.filter((b) => b.over === selectedOver);

  const stats = computeStats(filtered, dismissalPenalty);

  return (
    <>
      <Timeline
        balls={balls}
        otherBalls={otherBalls}
        dismissalPenalty={dismissalPenalty}
        selectedOver={selectedOver}
        onSelect={(o) => setSelectedOver((prev) => (prev === o ? null : o))}
        onClear={() => setSelectedOver(null)}
      />
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
    </>
  );
}

// --- Stats / Legend ---

interface Stats {
  runs: number;
  balls: number;
  boundaries: number;
  wickets: number;
}

function computeStats(balls: Ball[], dismissalPenalty: number): Stats {
  const wickets = balls.filter((b) => b.dismissed).length;
  const gross = balls.reduce((a, b) => a + b.runsBat + b.runsExtra, 0);
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

const COLORS = {
  dot: "#9ca3af",
  r1: "#5eb3ff",
  r4: "#4ade80",
  r6: "#fbbf24",
  neg: "#ef4444",
  wkt: "#ec4899",
};

function runColor(b: Pick<Ball, "runsBat">): string {
  if (b.runsBat < 0) return COLORS.neg;
  if (b.runsBat === 0) return COLORS.dot;
  if (b.runsBat >= 6) return COLORS.r6;
  if (b.runsBat >= 4) return COLORS.r4;
  return COLORS.r1;
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

// --- Timeline ---

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

function Timeline({
  balls,
  otherBalls,
  dismissalPenalty,
  selectedOver,
  onSelect,
  onClear,
}: {
  balls: Ball[];
  otherBalls?: Ball[];
  dismissalPenalty: number;
  selectedOver: number | null;
  onSelect: (over: number) => void;
  onClear: () => void;
}) {
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

  return (
    <div className="rounded-md border border-stone-800 bg-stone-900 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-semibold tracking-wider text-stone-500 uppercase">
          Over by over
        </h3>
        <button
          type="button"
          onClick={onClear}
          disabled={selectedOver === null}
          className="rounded border border-stone-800 px-2 py-0.5 text-xs text-stone-300 transition-colors hover:border-stone-700 disabled:cursor-default disabled:opacity-40 disabled:hover:border-stone-800"
        >
          Clear filter
        </button>
      </div>
      <p className="mb-2 text-xs text-stone-500">
        Tap an over to filter the wheel.
      </p>
      <div className="flex items-stretch gap-1 overflow-x-auto pb-1">
        {overs.map((o) => {
          const isSelected = selectedOver === o.over;
          return (
            <button
              key={o.over}
              type="button"
              onClick={() => onSelect(o.over)}
              className={
                "flex flex-1 shrink-0 grow basis-[60px] flex-col items-center rounded-md px-2 py-1 transition-colors " +
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

      <CumulativeChart
        balls={balls}
        otherBalls={otherBalls}
        dismissalPenalty={dismissalPenalty}
      />
    </div>
  );
}

// --- Cumulative runs chart ---

interface ChartPoint {
  x: number;
  y: number;
  ball: Ball;
}

function cumulative(
  balls: Ball[],
  dismissalPenalty: number,
): {
  points: ChartPoint[];
  wickets: ChartPoint[];
  yMin: number;
  yMax: number;
} {
  let total = 0;
  const points: ChartPoint[] = [];
  const wickets: ChartPoint[] = [];
  let yMax = 0;
  let yMin = 0;
  balls.forEach((b, idx) => {
    total += b.runsBat + b.runsExtra;
    // The dismissal penalty isn't applied to runs_bat upstream — apply it
    // here so the line visibly dips on each wicket.
    if (b.dismissed) total -= dismissalPenalty;
    if (total > yMax) yMax = total;
    if (total < yMin) yMin = total;
    const pt: ChartPoint = { x: idx, y: total, ball: b };
    points.push(pt);
    if (b.dismissed) wickets.push(pt);
  });
  return { points, wickets, yMin, yMax };
}

function CumulativeChart({
  balls,
  otherBalls,
  dismissalPenalty,
}: {
  balls: Ball[];
  otherBalls?: Ball[];
  dismissalPenalty: number;
}) {
  const current = useMemo(
    () => cumulative(balls, dismissalPenalty),
    [balls, dismissalPenalty],
  );
  const other = useMemo(
    () =>
      otherBalls && otherBalls.length > 0
        ? cumulative(otherBalls, dismissalPenalty)
        : null,
    [otherBalls, dismissalPenalty],
  );

  const [hover, setHover] = useState<ChartPoint | null>(null);

  if (current.points.length === 0) return null;

  const points = current.points;
  const wickets = current.wickets;
  const yMin = Math.min(current.yMin, other ? other.yMin : 0);
  const yMax = Math.max(current.yMax, other ? other.yMax : 0);

  // Inner SVG coordinate system: 0..1000 wide, 0..120 tall. Mapped to
  // 100% width via viewBox + preserveAspectRatio="none" so the chart
  // always fills the section.
  const W = 1000;
  const H = 120;
  const padY = 12;
  // x-axis spans the longer innings so both lines share scale.
  const xMax = Math.max(
    1,
    points.length - 1,
    other ? other.points.length - 1 : 0,
  );
  const yRange = Math.max(1, yMax - yMin);
  const sx = (x: number) => (x / xMax) * W;
  const sy = (y: number) => H - padY - ((y - yMin) / yRange) * (H - padY * 2);

  const toPath = (pts: ChartPoint[]): string =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p.x)} ${sy(p.y)}`).join(" ");

  const path = toPath(points);
  const otherPath = other ? toPath(other.points) : null;

  const lastPoint = points[points.length - 1];
  const totalRuns = lastPoint ? lastPoint.y : 0;
  const otherTotal = other?.points.at(-1)?.y ?? 0;

  function dismissalText(b: Ball): string {
    const batter = b.batterName ?? "Batter";
    const bowler = b.bowlerName ?? "bowler";
    return `${batter} out — ${bowler} bowling`;
  }

  return (
    <div className="relative mt-3 border-t border-stone-800 pt-3">
      <div className="mb-1 flex items-center justify-between gap-3 text-[10px] font-semibold tracking-wider text-stone-500 uppercase">
        <div className="flex items-center gap-3">
          <span>Cumulative runs</span>
          <span className="flex items-center gap-1 normal-case">
            <span
              className="inline-block h-0.5 w-3 rounded"
              style={{ backgroundColor: COLORS.r1 }}
            />
            this innings
          </span>
          {other && (
            <span className="flex items-center gap-1 normal-case">
              <span
                className="inline-block h-0.5 w-3 rounded"
                style={{ backgroundColor: "#5eb3ff", opacity: 0.35 }}
              />
              other innings
            </span>
          )}
        </div>
        <span className="font-mono text-stone-400 normal-case tabular-nums">
          {totalRuns} • {wickets.length} wkt
          {wickets.length === 1 ? "" : "s"}
          {other && <span className="text-stone-500"> (vs {otherTotal})</span>}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-[120px] w-full"
        role="img"
        aria-label={`Cumulative runs: ${totalRuns} runs, ${wickets.length} wickets`}
      >
        {/* Baseline at y=0 (or yMin if negative) */}
        <line
          x1={0}
          x2={W}
          y1={sy(0)}
          y2={sy(0)}
          stroke="#3b4253"
          strokeWidth={1}
          strokeDasharray="3 4"
        />
        {otherPath && (
          <path
            d={otherPath}
            fill="none"
            stroke="#5eb3ff"
            strokeWidth={2}
            strokeDasharray="4 3"
            opacity={0.35}
            vectorEffect="non-scaling-stroke"
          />
        )}
        <path
          d={path}
          fill="none"
          stroke={COLORS.r1}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
        {wickets.map((w) => (
          <g
            key={`${w.ball.over}-${w.ball.ball}`}
            onMouseEnter={() => setHover(w)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(w)}
            onBlur={() => setHover(null)}
            tabIndex={0}
            style={{ cursor: "pointer" }}
          >
            <line
              x1={sx(w.x)}
              x2={sx(w.x)}
              y1={padY}
              y2={H - padY}
              stroke={COLORS.wkt}
              strokeWidth={1}
              strokeDasharray="2 2"
              opacity={0.5}
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={sx(w.x)} cy={sy(w.y)} r={9} fill={COLORS.wkt} />
            <text
              x={sx(w.x)}
              y={sy(w.y)}
              fill="#0c0a09"
              fontSize={11}
              fontWeight={700}
              textAnchor="middle"
              dominantBaseline="central"
              style={{ pointerEvents: "none" }}
            >
              W
            </text>
            {/* Bigger invisible hit target */}
            <circle cx={sx(w.x)} cy={sy(w.y)} r={16} fill="transparent" />
          </g>
        ))}
      </svg>
      {hover &&
        (() => {
          const pctX = (sx(hover.x) / W) * 100;
          const pctY = (sy(hover.y) / H) * 100;
          const onRight = pctX > 60;
          const style: React.CSSProperties = onRight
            ? {
                right: `${100 - pctX}%`,
                top: `calc(${pctY}% + 8px)`,
                transform: "translateX(-8px)",
              }
            : {
                left: `${pctX}%`,
                top: `calc(${pctY}% + 8px)`,
                transform: "translateX(8px)",
              };
          return (
            <div
              className="pointer-events-none absolute z-10 max-w-[260px] rounded-md border border-stone-800 bg-stone-950/95 px-2 py-1.5 text-xs text-stone-100 shadow-lg"
              style={style}
            >
              <div className="font-semibold">{dismissalText(hover.ball)}</div>
              <div className="mt-0.5 text-[11px] text-stone-400">
                {hover.ball.over}.{hover.ball.ballDisp} • score {hover.y}
              </div>
            </div>
          );
        })()}
    </div>
  );
}

// --- Wheel ---

const ROPE = 240;
// Must be > the maximum shotRadius (278 for sixes) plus marker padding so
// dismissal rings on boundaries don't clip against the viewBox edge.
const VIEW = 295;
const MAX_LEN = 50;

function shotRadius(b: Pick<Ball, "runsBat" | "shotLength">): number {
  if (b.runsBat >= 6) return 278;
  if (b.runsBat >= 4) return 256;
  if (b.shotLength == null) return 0;
  return (b.shotLength / MAX_LEN) * 210;
}

function polar(deg: number, r: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [Math.sin(a) * r, Math.cos(a) * r];
}

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
      <svg
        viewBox={`-${VIEW} -${VIEW} ${VIEW * 2} ${VIEW * 2}`}
        className="block h-full w-full touch-none"
        role="img"
        aria-label="Wagon wheel — shot directions plotted from the wicket"
      >
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
  const batter = ball.batterName ?? `#${ball.batterRvId ?? "?"}`;
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
