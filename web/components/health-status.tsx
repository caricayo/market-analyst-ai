interface Heartbeat {
  timestamp: string;
  status: string;
  message: string | null;
}

interface Props {
  jobName: string;
  heartbeat: Heartbeat | null;
}

const JOB_LABELS: Record<string, string> = {
  morning_routine: "Morning Routine",
  intraday_monitor: "Intraday Monitor",
  eod_exit: "EOD Exit",
  weekly_retrain: "Weekly Retrain",
};

export default function HealthStatus({ jobName, heartbeat }: Props) {
  const label = JOB_LABELS[jobName] ?? jobName;

  let dotColor = "bg-slate-600";
  let statusText = "Never run";

  if (heartbeat) {
    dotColor = heartbeat.status === "ok" ? "bg-emerald-400" : "bg-red-400";
    const ago = Date.now() - new Date(heartbeat.timestamp).getTime();
    const hoursAgo = Math.floor(ago / 3_600_000);
    const minsAgo = Math.floor((ago % 3_600_000) / 60_000);
    statusText = hoursAgo > 0 ? `${hoursAgo}h ${minsAgo}m ago` : `${minsAgo}m ago`;
  }

  return (
    <div className="flex items-center gap-3 bg-slate-800 rounded-lg px-4 py-3">
      <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotColor}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-100">{label}</p>
        <p className="text-xs text-slate-400">{statusText}</p>
        {heartbeat?.message && heartbeat.status !== "ok" && (
          <p className="text-xs text-red-400 truncate">{heartbeat.message}</p>
        )}
      </div>
    </div>
  );
}
