// eslint-disable-next-line react-doctor/prefer-dynamic-import -- this whole file is lazy-loaded by treasurer-tab.tsx via React.lazy(); recharts is correctly isolated to this chunk
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const GBP_FORMATTER = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

interface MonthRow {
  month: string;
  Membership: number;
  Sponsorship: number;
  Donation: number;
  Manual: number;
  Other: number;
}

export function TreasurerIncomeChart({ data }: { data: MonthRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="month" />
        <YAxis />
        <Tooltip formatter={(value) => GBP_FORMATTER.format(Number(value))} />
        <Legend />
        <Bar
          dataKey="Membership"
          stackId="a"
          fill="#2563eb"
          name="Membership"
        />
        <Bar
          dataKey="Sponsorship"
          stackId="a"
          fill="#16a34a"
          name="Sponsorship"
        />
        <Bar dataKey="Donation" stackId="a" fill="#f59e0b" name="Donation" />
        <Bar dataKey="Manual" stackId="a" fill="#8b5cf6" name="Manual" />
        <Bar dataKey="Other" stackId="a" fill="#6b7280" name="Other" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default TreasurerIncomeChart;
