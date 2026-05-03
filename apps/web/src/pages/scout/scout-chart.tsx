import type { ChartSpec } from "@percy-main/shared";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Label,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

// Chart colour pool — colour-blind-safe-ish, picked to read fine on both
// white message-list backgrounds. Keep the count high enough to cover most
// "by-month" or "by-season" series without repeats.
const SERIES_COLOURS = [
  "#1f77b4",
  "#ff7f0e",
  "#2ca02c",
  "#d62728",
  "#9467bd",
  "#8c564b",
  "#e377c2",
  "#17becf",
];

const HEIGHT = 260;

export function ScoutChart({ spec }: { spec: ChartSpec }) {
  return (
    <figure className="my-3 rounded border border-gray-200 bg-white p-3">
      <figcaption className="mb-2 text-sm font-semibold text-gray-800">
        {spec.title}
      </figcaption>
      <div style={{ width: "100%", height: HEIGHT }}>
        <ResponsiveContainer>
          <ChartBody spec={spec} />
        </ResponsiveContainer>
      </div>
      {spec.caption && (
        <p className="mt-2 text-xs text-gray-500">{spec.caption}</p>
      )}
    </figure>
  );
}

function ChartBody({ spec }: { spec: ChartSpec }) {
  if (spec.type === "bar") {
    return (
      <BarChart
        data={spec.data}
        margin={{ top: 8, right: 16, bottom: 24, left: 8 }}
      >
        <CartesianGrid stroke="#eee" strokeDasharray="3 3" />
        <XAxis dataKey="x" tick={{ fontSize: 11 }}>
          {spec.xLabel ? (
            <Label value={spec.xLabel} position="insideBottom" offset={-12} />
          ) : null}
        </XAxis>
        <YAxis tick={{ fontSize: 11 }}>
          {spec.yLabel ? (
            <Label value={spec.yLabel} angle={-90} position="insideLeft" />
          ) : null}
        </YAxis>
        <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
        <Bar dataKey="y" fill={SERIES_COLOURS[0]} />
      </BarChart>
    );
  }

  if (spec.type === "line") {
    const seriesNames = uniqueSeries(spec.data, "single line");
    const grouped = groupBy(spec.data, (d) => d.series ?? "single line");

    return (
      <LineChart margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
        <CartesianGrid stroke="#eee" strokeDasharray="3 3" />
        <XAxis
          dataKey="x"
          type="category"
          allowDuplicatedCategory={false}
          tick={{ fontSize: 11 }}
        >
          {spec.xLabel ? (
            <Label value={spec.xLabel} position="insideBottom" offset={-12} />
          ) : null}
        </XAxis>
        <YAxis tick={{ fontSize: 11 }}>
          {spec.yLabel ? (
            <Label value={spec.yLabel} angle={-90} position="insideLeft" />
          ) : null}
        </YAxis>
        <Tooltip />
        {seriesNames.length > 1 ? <Legend /> : null}
        {seriesNames.map((name, i) => (
          <Line
            key={name}
            type="monotone"
            dataKey="y"
            data={grouped.get(name)}
            name={name}
            stroke={SERIES_COLOURS[i % SERIES_COLOURS.length]}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        ))}
      </LineChart>
    );
  }

  // scatter
  const scatterSeries = uniqueSeries(spec.data, "points");
  const scatterGroups = groupBy(spec.data, (d) => d.series ?? "points");

  return (
    <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
      <CartesianGrid stroke="#eee" strokeDasharray="3 3" />
      <XAxis dataKey="x" type="number" tick={{ fontSize: 11 }}>
        {spec.xLabel ? (
          <Label value={spec.xLabel} position="insideBottom" offset={-12} />
        ) : null}
      </XAxis>
      <YAxis dataKey="y" type="number" tick={{ fontSize: 11 }}>
        {spec.yLabel ? (
          <Label value={spec.yLabel} angle={-90} position="insideLeft" />
        ) : null}
      </YAxis>
      <ZAxis range={[40, 40]} />
      <Tooltip
        cursor={{ strokeDasharray: "3 3" }}
        content={<ScatterTooltip />}
      />
      {scatterSeries.length > 1 ? <Legend /> : null}
      {scatterSeries.map((name, i) => (
        <Scatter
          key={name}
          name={name}
          data={scatterGroups.get(name)}
          fill={SERIES_COLOURS[i % SERIES_COLOURS.length]}
        />
      ))}
    </ScatterChart>
  );
}

function uniqueSeries(
  data: Array<{ series?: string }>,
  fallback: string,
): string[] {
  const set = new Set<string>();
  for (const d of data) set.add(d.series ?? fallback);
  return Array.from(set);
}

function groupBy<T>(data: T[], keyFn: (d: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const d of data) {
    const k = keyFn(d);
    const arr = map.get(k);
    if (arr) arr.push(d);
    else map.set(k, [d]);
  }
  return map;
}

interface ScatterTooltipPayload {
  payload?: { x?: number; y?: number; label?: string; series?: string };
}

function ScatterTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ScatterTooltipPayload[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="rounded border border-gray-200 bg-white px-2 py-1 text-xs shadow-sm">
      {p.label ? <div className="font-medium">{p.label}</div> : null}
      <div className="text-gray-600">
        x: {p.x} · y: {p.y}
      </div>
    </div>
  );
}
