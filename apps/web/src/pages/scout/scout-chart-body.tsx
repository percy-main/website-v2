import type { ChartSpec } from "@percy-main/shared";
// eslint-disable-next-line react-doctor/prefer-dynamic-import -- this whole file is lazy-loaded by scout-chart.tsx via React.lazy(); chart.js is correctly isolated to this chunk
import {
  ArcElement,
  BarController,
  BarElement,
  BubbleController,
  CategoryScale,
  Chart as ChartJS,
  type ChartOptions,
  DoughnutController,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PieController,
  PointElement,
  PolarAreaController,
  RadarController,
  RadialLinearScale,
  ScatterController,
  Title,
  Tooltip,
} from "chart.js";
// eslint-disable-next-line react-doctor/prefer-dynamic-import -- same chunk as chart.js above; lazy-loaded by scout-chart.tsx
import { Chart } from "react-chartjs-2";

// Register every controller / element / scale Chart.js v4 needs for the
// types we accept on the wire. Chart.js v4 is tree-shakeable; nothing is
// pulled in unless registered, so listing exactly what we support keeps the
// chunk lean.
ChartJS.register(
  BarController,
  LineController,
  ScatterController,
  BubbleController,
  PieController,
  DoughnutController,
  PolarAreaController,
  RadarController,
  ArcElement,
  BarElement,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  RadialLinearScale,
  Title,
  Tooltip,
  Legend,
  Filler,
);

// Sensible defaults that the model rarely sets but make charts readable in
// the message stream. Merged shallowly with whatever the model provides.
const DEFAULT_OPTIONS: ChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
};

export function ChartBody({ spec }: { spec: ChartSpec }) {
  // react-chartjs-2's <Chart type="..."> takes the chart type as a prop.
  // data and options are passed through unchanged — this is the entire point
  // of switching off the bespoke schema: trust Chart.js to handle the spec
  // the model produced.
  const merged: ChartOptions = {
    ...DEFAULT_OPTIONS,
    ...((spec.options ?? {}) as ChartOptions),
  };
  return <Chart type={spec.type} data={spec.data as never} options={merged} />;
}
