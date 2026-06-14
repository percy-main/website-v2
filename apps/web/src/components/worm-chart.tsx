import {
  COLORS,
  CRICKET_BLOCK_PANEL_CLASSES,
  dismissalText,
  type Ball,
} from "@/components/wagon-wheel-shared.js";
import { useWagonWheelQuery } from "@/hooks/use-wagon-wheel.js";
import { useMemo, useState } from "react";

// --- Cumulative runs chart ---
//
// The "worm": cumulative runs plotted against ball index. Shared by the
// ball-by-ball wagon wheel viewer (rendered above the wheel) and the
// standalone WormChart content block.

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

export function CumulativeChart({
  balls,
  otherBalls,
  dismissalPenalty,
  primaryLabel,
  secondaryLabel,
}: {
  balls: Ball[];
  otherBalls?: Ball[];
  dismissalPenalty: number;
  // When provided (the standalone worm chart), team names label the lines;
  // omitted in the wheel viewer, where the generic "Cumulative runs" reads
  // fine alongside the innings tabs.
  primaryLabel?: string;
  secondaryLabel?: string;
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

  // Axis markers: every 5 overs on x, every 50 runs on y. The x-axis is
  // ball-indexed, so map each over boundary to the index of its first ball in
  // the current (primary) innings.
  const firstIdxByOver = new Map<number, number>();
  let maxOver = 0;
  points.forEach((p, i) => {
    if (!firstIdxByOver.has(p.ball.over)) firstIdxByOver.set(p.ball.over, i);
    if (p.ball.over > maxOver) maxOver = p.ball.over;
  });
  const overMarks: Array<{ over: number; x: number }> = [];
  for (let t = 5; t <= maxOver; t += 5) {
    const idx = firstIdxByOver.get(t);
    if (idx !== undefined) overMarks.push({ over: t, x: idx });
  }
  const runMarks: number[] = [];
  for (let v = Math.ceil(yMin / 50) * 50; v <= yMax; v += 50) {
    if (v !== 0) runMarks.push(v); // 0 already drawn as the baseline
  }

  const toPath = (pts: ChartPoint[]): string =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p.x)} ${sy(p.y)}`).join(" ");

  const path = toPath(points);
  const otherPath = other ? toPath(other.points) : null;

  const lastPoint = points[points.length - 1];
  const totalRuns = lastPoint ? lastPoint.y : 0;
  const otherTotal = other?.points.at(-1)?.y ?? 0;

  return (
    <div className="relative rounded-md border border-stone-800 bg-stone-900 p-3">
      <div className="mb-1 flex items-center justify-between gap-3 text-[10px] font-semibold tracking-wider text-stone-500 uppercase">
        <span>{primaryLabel ?? "Cumulative runs"}</span>
        <span className="font-mono text-stone-400 normal-case tabular-nums">
          {totalRuns} • {wickets.length} wkt
          {wickets.length === 1 ? "" : "s"}
          {other && (
            <span className="text-stone-500">
              {" "}
              (vs {secondaryLabel ? `${secondaryLabel} ` : ""}
              {otherTotal})
            </span>
          )}
        </span>
      </div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="block h-[120px] w-full"
          role="img"
          aria-label={`Cumulative runs: ${totalRuns} runs, ${wickets.length} wickets`}
        >
          {/* Run gridlines every 50 (y) */}
          {runMarks.map((v) => (
            <line
              key={`run-${v}`}
              x1={0}
              x2={W}
              y1={sy(v)}
              y2={sy(v)}
              stroke="#2a2f3d"
              strokeWidth={1}
              strokeDasharray="2 5"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {/* Over gridlines every 5 (x) */}
          {overMarks.map((m) => (
            <line
              key={`over-${m.over}`}
              x1={sx(m.x)}
              x2={sx(m.x)}
              y1={padY}
              y2={H - padY}
              stroke="#2a2f3d"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
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
            <line
              key={`${w.ball.over}-${w.ball.ball}-line`}
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
          ))}
        </svg>
        {/* Axis labels as HTML overlays — SVG text would distort under
          preserveAspectRatio="none". Runs up the left, overs along the bottom. */}
        {runMarks.map((v) => (
          <span
            key={`run-lbl-${v}`}
            className="pointer-events-none absolute left-0 -translate-y-1/2 bg-stone-900/80 pr-1 font-mono text-[9px] text-stone-500 tabular-nums"
            style={{ top: `${(sy(v) / H) * 100}%` }}
          >
            {v}
          </span>
        ))}
        {overMarks.map((m) => (
          <span
            key={`over-lbl-${m.over}`}
            className="pointer-events-none absolute bottom-0 -translate-x-1/2 font-mono text-[9px] text-stone-500 tabular-nums"
            style={{ left: `${(sx(m.x) / W) * 100}%` }}
          >
            {m.over}
          </span>
        ))}
        {/* W markers as HTML overlays. The SVG uses preserveAspectRatio="none",
          so shapes drawn in viewBox units stretch non-uniformly (tall/skinny
          ovals on mobile). HTML divs anchored by % stay circular. */}
        {wickets.map((w) => {
          const pctX = (sx(w.x) / W) * 100;
          const pctY = (sy(w.y) / H) * 100;
          return (
            <button
              key={`${w.ball.over}-${w.ball.ball}`}
              type="button"
              onMouseEnter={() => setHover(w)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(w)}
              onBlur={() => setHover(null)}
              className="absolute flex size-[18px] -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-[11px] font-bold text-stone-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-100"
              style={{
                left: `${pctX}%`,
                top: `${pctY}%`,
                backgroundColor: COLORS.wkt,
              }}
              aria-label={`Wicket at over ${w.ball.over}.${w.ball.ballDisp}`}
            >
              W
            </button>
          );
        })}
      </div>
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

// --- WormChart content block ---

interface WormInnings {
  inningsNumber: number;
  balls: Ball[];
}

/**
 * Standalone worm chart for a match, embeddable in editorial content. Shows
 * cumulative runs for both innings on one chart, the chosen team's line
 * highlighted (solid) and the other faded. Unlike the wagon wheel it needs
 * only runs per ball, not shot directions, so it works for any live-scored
 * match.
 */
export function WormChart({
  matchId,
  primaryInningsNumber,
  inningsTeamNames,
}: {
  matchId: string;
  primaryInningsNumber?: number;
  inningsTeamNames?: string[];
}) {
  const { data, isLoading, isError } = useWagonWheelQuery(matchId);
  const inningsWithBalls = useMemo(
    () => (data ? data.innings.filter((inn) => inn.balls.length > 0) : []),
    [data],
  );

  return (
    <div className={CRICKET_BLOCK_PANEL_CLASSES}>
      {isLoading && <WormMessage>Loading worm chart…</WormMessage>}
      {isError && (
        <WormMessage tone="error">
          Couldn&apos;t load ball-by-ball data. Please try again.
        </WormMessage>
      )}
      {!isLoading && !isError && inningsWithBalls.length === 0 && (
        <WormMessage>
          No ball-by-ball data for this match yet, so there&apos;s nothing to
          plot.
        </WormMessage>
      )}
      {!isLoading && !isError && inningsWithBalls.length > 0 && data && (
        <WormChartView
          key={String(primaryInningsNumber ?? "")}
          innings={inningsWithBalls}
          dismissalPenalty={data.dismissalPenalty}
          primaryInningsNumber={primaryInningsNumber}
          inningsTeamNames={inningsTeamNames}
        />
      )}
    </div>
  );
}

function WormChartView({
  innings,
  dismissalPenalty,
  primaryInningsNumber,
  inningsTeamNames,
}: {
  innings: WormInnings[];
  dismissalPenalty: number;
  primaryInningsNumber?: number;
  inningsTeamNames?: string[];
}) {
  const initialIndex = useMemo(() => {
    if (primaryInningsNumber == null) return 0;
    const i = innings.findIndex(
      (inn) => inn.inningsNumber === primaryInningsNumber,
    );
    return i >= 0 ? i : 0;
  }, [innings, primaryInningsNumber]);

  const [primaryIndex, setPrimaryIndex] = useState(initialIndex);
  const primary = innings[primaryIndex] ?? innings[0];
  const other = innings.find((_, i) => i !== primaryIndex);

  const label = (inn: WormInnings) =>
    inningsTeamNames?.[inn.inningsNumber - 1] ?? `Innings ${inn.inningsNumber}`;

  return (
    <div className="flex flex-col gap-3">
      {innings.length > 1 && (
        <div
          className="flex gap-2"
          role="tablist"
          aria-label="Highlight innings"
        >
          {innings.map((inn, idx) => {
            const isActive = idx === primaryIndex;
            return (
              <button
                key={inn.inningsNumber}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setPrimaryIndex(idx)}
                className={
                  "rounded-md border px-3 py-1.5 text-sm transition-colors " +
                  (isActive
                    ? "border-stone-600 bg-stone-800 text-stone-50"
                    : "border-stone-800 bg-stone-900 text-stone-400 hover:border-stone-700 hover:text-stone-200")
                }
              >
                {label(inn)}
              </button>
            );
          })}
        </div>
      )}
      <CumulativeChart
        balls={primary.balls}
        otherBalls={other?.balls}
        dismissalPenalty={dismissalPenalty}
        primaryLabel={label(primary)}
        secondaryLabel={other ? label(other) : undefined}
      />
    </div>
  );
}

function WormMessage({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "error";
}) {
  return (
    <div
      className={
        tone === "error"
          ? "rounded-md border border-red-900 bg-red-950/40 p-4 text-sm text-red-200"
          : "rounded-md border border-stone-800 bg-stone-900 p-4 text-sm text-stone-400"
      }
    >
      {children}
    </div>
  );
}
