import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type {
  BtcSignalExecutionControl,
  PersistedSignalExecutionControl,
  SignalExecutionControlMode,
  SignalExecutionControlReason,
} from "@/lib/signal-types";

type SignalControlRow = {
  scope: string;
  mode: SignalExecutionControlMode;
  reason: SignalExecutionControlReason;
  message: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

const SIGNAL_CONTROL_SCOPE = "btc_signal_live";

const controlStore = globalThis as typeof globalThis & {
  __btcSignalExecutionControl?: PersistedSignalExecutionControl;
};

function getDefaultControlState(): PersistedSignalExecutionControl {
  const now = new Date(0).toISOString();
  return {
    scope: SIGNAL_CONTROL_SCOPE,
    mode: "running",
    reason: null,
    message: "Auto-execution is live.",
    updatedBy: null,
    createdAt: now,
    updatedAt: now,
  };
}

function toControl(row: SignalControlRow): PersistedSignalExecutionControl {
  return {
    scope: row.scope,
    mode: row.mode,
    reason: row.reason,
    message: row.message,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRow(control: PersistedSignalExecutionControl): SignalControlRow {
  return {
    scope: control.scope,
    mode: control.mode,
    reason: control.reason,
    message: control.message,
    updated_by: control.updatedBy,
    created_at: control.createdAt,
    updated_at: control.updatedAt,
  };
}

function getControlStore() {
  if (!controlStore.__btcSignalExecutionControl) {
    controlStore.__btcSignalExecutionControl = getDefaultControlState();
  }
  return controlStore.__btcSignalExecutionControl;
}

async function persistControl(control: PersistedSignalExecutionControl) {
  const supabase = createAdminSupabaseClient();
  if (!supabase) {
    return;
  }

  const { error } = await supabase
    .from("btc_signal_control_state")
    .upsert(toRow(control), { onConflict: "scope" });

  if (error) {
    throw error;
  }
}

export async function hydrateSignalExecutionControl() {
  const supabase = createAdminSupabaseClient();
  if (!supabase) {
    controlStore.__btcSignalExecutionControl = getDefaultControlState();
    return controlStore.__btcSignalExecutionControl;
  }

  const { data } = await supabase
    .from("btc_signal_control_state")
    .select("*")
    .eq("scope", SIGNAL_CONTROL_SCOPE)
    .maybeSingle();

  controlStore.__btcSignalExecutionControl = data
    ? toControl(data as SignalControlRow)
    : getDefaultControlState();

  if (!data) {
    await persistControl(controlStore.__btcSignalExecutionControl).catch(() => undefined);
  }

  return controlStore.__btcSignalExecutionControl;
}

export function getSignalExecutionControlState() {
  return getControlStore();
}

export function toPublicSignalExecutionControl(
  control: PersistedSignalExecutionControl | null | undefined,
): BtcSignalExecutionControl {
  const source = control ?? getControlStore();
  return {
    mode: source.mode,
    reason: source.reason,
    message: source.message,
    updatedAt: source.updatedAt,
    updatedBy: source.updatedBy,
  };
}

export async function setSignalExecutionControlState(input: {
  mode: SignalExecutionControlMode;
  reason: SignalExecutionControlReason;
  message: string;
  updatedBy?: string | null;
}) {
  const existing = getControlStore();
  const now = new Date().toISOString();
  const next: PersistedSignalExecutionControl = {
    scope: SIGNAL_CONTROL_SCOPE,
    mode: input.mode,
    reason: input.reason,
    message: input.message,
    updatedBy: input.updatedBy ?? null,
    createdAt: existing.createdAt ?? now,
    updatedAt: now,
  };

  controlStore.__btcSignalExecutionControl = next;
  await persistControl(next).catch(() => undefined);
  return next;
}

