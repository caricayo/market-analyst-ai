"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { StageState } from "@/lib/types";

interface PipelineTrackerProps {
  stages: StageState[];
  collapsed?: boolean;
}

function StageIcon({ status }: { status: StageState["status"] }) {
  switch (status) {
    case "complete":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" className="text-t-green">
          <path
            d="M13.5 4.5L6 12L2.5 8.5"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
            strokeLinecap="square"
          />
        </svg>
      );
    case "running":
      return (
        <div className="w-4 h-4 border-2 border-t-green border-t-transparent spinner" />
      );
    case "error":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" className="text-t-red">
          <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
        </svg>
      );
    default:
      return <div className="w-3 h-3 border border-t-dim bg-transparent mx-0.5" />;
  }
}

function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() / 1000 - startedAt) * 10) / 10);
    }, 100);
    return () => clearInterval(interval);
  }, [startedAt]);

  return (
    <span className="text-t-green tabular-nums text-xs">
      {elapsed.toFixed(1)}s
    </span>
  );
}

export default function PipelineTracker({ stages, collapsed }: PipelineTrackerProps) {
  if (collapsed) {
    const allComplete = stages.every((s) => s.status === "complete");
    if (!allComplete) return null;
    return (
      <div className="flex items-center gap-2 text-xs text-t-dim py-2">
        <svg width="14" height="14" viewBox="0 0 16 16" className="text-t-green">
          <path d="M13.5 4.5L6 12L2.5 8.5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="square" />
        </svg>
        Pipeline complete — all stages passed
      </div>
    );
  }

  return (
    <div className="space-y-0" role="progressbar" aria-label="Pipeline progress">
      <AnimatePresence>
        {stages.map((stage, i) => (
          <motion.div
            key={stage.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            className={`flex items-center gap-3 py-2 px-3 border-l-2 ${
              stage.status === "running"
                ? "border-t-green bg-t-green/5 pulse-active"
                : stage.status === "complete"
                  ? "border-t-green/40"
                  : stage.status === "error"
                    ? "border-t-red"
                    : "border-t-border"
            }`}
          >
            <StageIcon status={stage.status} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs font-bold uppercase tracking-wider ${
                    stage.status === "running"
                      ? "text-t-green"
                      : stage.status === "complete"
                        ? "text-t-green-dim"
                        : stage.status === "error"
                          ? "text-t-red"
                          : "text-t-dim"
                  }`}
                >
                  {stage.label}
                </span>
              </div>
              {stage.detail && (
                <p className="text-[10px] text-t-dim truncate mt-0.5">
                  {stage.detail}
                </p>
              )}
            </div>
            <div className="text-right shrink-0">
              {stage.status === "running" && stage.startedAt && (
                <ElapsedTimer startedAt={stage.startedAt} />
              )}
              {stage.status === "complete" && stage.startedAt && stage.completedAt && (
                <span className="text-xs text-t-dim tabular-nums">
                  {(stage.completedAt - stage.startedAt).toFixed(1)}s
                </span>
              )}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
