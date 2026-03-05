interface PortfolioCardProps {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
}

export default function PortfolioCard({ label, value, sub, positive }: PortfolioCardProps) {
  const valueColor =
    positive === true
      ? "text-emerald-400"
      : positive === false
      ? "text-red-400"
      : "text-slate-100";

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className={`text-xl font-mono font-bold ${valueColor}`}>{value}</p>
      {sub && <p className={`text-xs mt-1 ${valueColor} opacity-75`}>{sub}</p>}
    </div>
  );
}
