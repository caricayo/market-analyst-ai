import { createClient } from "@/lib/supabase/server";
import HealthStatus from "@/components/health-status";
import KillSwitchBanner from "@/components/kill-switch-banner";

export const revalidate = 30;

const JOBS = ["morning_routine", "intraday_monitor", "eod_exit", "weekly_retrain"];

export default async function HealthPage() {
  const supabase = createClient();

  // Latest heartbeat per job — all 4 in parallel
  const heartbeatResults = await Promise.all(
    JOBS.map((job) =>
      supabase
        .from("heartbeats")
        .select("timestamp, status, message")
        .eq("job_name", job)
        .order("timestamp", { ascending: false })
        .limit(1)
        .single()
        .then(({ data }) => ({ job, data }))
    )
  );
  const heartbeatMap: Record<string, { timestamp: string; status: string; message: string | null }> = {};
  for (const { job, data } of heartbeatResults) {
    if (data) heartbeatMap[job] = data;
  }

  // Kill switch events
  const { data: killEvents } = await supabase
    .from("kill_switch_log")
    .select("*")
    .order("triggered_at", { ascending: false })
    .limit(20);

  // Current model
  const { data: currentModel } = await supabase
    .from("model_versions")
    .select("version_tag, auc_score, wf_auc_mean, lgb_wf_auc, trained_at")
    .eq("is_current", true)
    .single();

  const activeKill = (killEvents ?? []).find((e) => !e.resolved_at);

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-bold text-slate-100">System Health</h1>

      {activeKill && <KillSwitchBanner event={activeKill} />}

      {/* Heartbeats */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-slate-400 mb-4 uppercase tracking-wide">
          Scheduler Jobs
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {JOBS.map((job) => (
            <HealthStatus key={job} jobName={job} heartbeat={heartbeatMap[job] ?? null} />
          ))}
        </div>
      </div>

      {/* Model info */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-slate-400 mb-3 uppercase tracking-wide">
          Current Model
        </h2>
        {currentModel ? (
          <div className="space-y-1 text-sm">
            <p><span className="text-slate-400">Version:</span> <span className="text-slate-100">{currentModel.version_tag}</span></p>
            <p><span className="text-slate-400">XGB AUC:</span> <span className="text-slate-100">{currentModel.auc_score?.toFixed(4)}</span></p>
            <p><span className="text-slate-400">XGB WF AUC:</span> <span className="text-slate-100">{currentModel.wf_auc_mean?.toFixed(4) ?? "—"}</span></p>
            <p><span className="text-slate-400">LGB WF AUC:</span> <span className="text-slate-100">{currentModel.lgb_wf_auc?.toFixed(4) ?? "—"}</span></p>
            <p><span className="text-slate-400">Trained:</span> <span className="text-slate-100">{new Date(currentModel.trained_at).toLocaleString()}</span></p>
          </div>
        ) : (
          <p className="text-slate-500 text-sm">No current model found</p>
        )}
      </div>

      {/* Kill switch log */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-slate-400 mb-3 uppercase tracking-wide">
          Kill Switch Log
        </h2>
        {(killEvents ?? []).length === 0 ? (
          <p className="text-slate-500 text-sm">No events — system healthy</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 border-b border-slate-700">
                  <th className="text-left py-2 pr-4">Level</th>
                  <th className="text-left py-2 pr-4">Triggered</th>
                  <th className="text-right py-2 pr-4">Portfolio</th>
                  <th className="text-right py-2">Resolved</th>
                </tr>
              </thead>
              <tbody>
                {(killEvents ?? []).map((e) => (
                  <tr
                    key={e.id}
                    className={`border-b border-slate-800 ${!e.resolved_at ? "bg-red-950/40" : ""}`}
                  >
                    <td className="py-2 pr-4 text-red-400 uppercase">{e.level}</td>
                    <td className="py-2 pr-4 text-slate-300">
                      {new Date(e.triggered_at).toLocaleString()}
                    </td>
                    <td className="py-2 pr-4 text-right text-slate-300">
                      ${e.portfolio_value?.toFixed(2)}
                    </td>
                    <td className="py-2 text-right">
                      {e.resolved_at ? (
                        <span className="text-emerald-400">Resolved</span>
                      ) : (
                        <span className="text-red-400">Active</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
