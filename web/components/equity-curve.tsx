"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface DataPoint {
  date: string;
  portfolio_value_end: number | null;
}

interface Props {
  data: DataPoint[];
}

export default function EquityCurve({ data }: Props) {
  if (data.length === 0) {
    return <p className="text-slate-500 text-sm">No data yet</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis
          dataKey="date"
          tick={{ fill: "#94a3b8", fontSize: 10 }}
          tickFormatter={(v) => v.slice(5)}
        />
        <YAxis
          tick={{ fill: "#94a3b8", fontSize: 10 }}
          tickFormatter={(v) => `$${v.toLocaleString()}`}
          width={72}
        />
        <Tooltip
          contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 4 }}
          labelStyle={{ color: "#94a3b8" }}
          itemStyle={{ color: "#34d399" }}
          formatter={(v: number) => [`$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, "Portfolio"]}
        />
        <Line
          type="monotone"
          dataKey="portfolio_value_end"
          stroke="#34d399"
          dot={false}
          strokeWidth={2}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
