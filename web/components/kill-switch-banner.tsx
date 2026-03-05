interface KillSwitchEvent {
  id: number;
  level: string;
  trigger_pct: number;
  portfolio_value: number;
  message: string | null;
  triggered_at: string;
}

interface Props {
  event: KillSwitchEvent;
}

export default function KillSwitchBanner({ event }: Props) {
  return (
    <div className="bg-red-950 border border-red-700 rounded-lg px-4 py-3 flex items-start gap-3">
      <div className="w-2.5 h-2.5 rounded-full bg-red-400 mt-1 shrink-0 animate-pulse" />
      <div>
        <p className="text-sm font-bold text-red-300 uppercase">
          Kill Switch Active — {event.level} level
        </p>
        <p className="text-xs text-red-400 mt-0.5">
          Triggered at {new Date(event.triggered_at).toLocaleString()} &bull;{" "}
          Portfolio: ${event.portfolio_value.toFixed(2)} &bull;{" "}
          Loss: {event.trigger_pct.toFixed(2)}%
        </p>
        {event.message && (
          <p className="text-xs text-red-400 mt-1">{event.message}</p>
        )}
      </div>
    </div>
  );
}
