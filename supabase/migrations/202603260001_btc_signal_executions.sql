create table if not exists public.btc_signal_executions (
  id uuid primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  window_id uuid not null references public.btc_signal_windows(id) on delete cascade,
  window_ticker text not null unique,
  status text not null check (status in ('waiting', 'submitted', 'partial_fill', 'unfilled', 'skipped_no_signal', 'error', 'resolved')),
  locked_action text check (locked_action in ('buy_yes', 'buy_no', 'no_buy')),
  locked_side text check (locked_side in ('yes', 'no')),
  decision_snapshot_id uuid references public.btc_signal_snapshots(id) on delete set null,
  decision_observed_at timestamptz,
  submitted_at timestamptz,
  entry_price_dollars numeric(12, 4),
  submitted_contracts integer not null default 0,
  filled_contracts integer not null default 0,
  max_cost_dollars numeric(12, 2),
  order_id text,
  client_order_id text,
  message text not null default '',
  resolution_outcome text check (resolution_outcome in ('above', 'below')),
  realized_pnl_dollars numeric(12, 2)
);

create index if not exists btc_signal_executions_status_idx
  on public.btc_signal_executions (status, updated_at desc);

create index if not exists btc_signal_executions_window_idx
  on public.btc_signal_executions (window_id, updated_at desc);

alter table public.btc_signal_executions enable row level security;

drop policy if exists "btc signal executions service only" on public.btc_signal_executions;
create policy "btc signal executions service only"
  on public.btc_signal_executions
  for all
  using (false)
  with check (false);
