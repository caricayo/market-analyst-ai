create table if not exists public.btc_signal_windows (
  id uuid primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  market_ticker text not null unique,
  market_title text,
  open_time timestamptz not null,
  close_time timestamptz,
  expiration_time timestamptz,
  strike_price_dollars numeric(12, 4),
  status text not null check (status in ('active', 'resolved')),
  resolution_outcome text check (resolution_outcome in ('above', 'below')),
  settlement_proxy_price_dollars numeric(12, 4),
  outcome_source text check (outcome_source in ('coinbase_proxy'))
);

create table if not exists public.btc_signal_snapshots (
  id uuid primary key,
  created_at timestamptz not null default now(),
  window_id uuid not null references public.btc_signal_windows(id) on delete cascade,
  market_ticker text not null,
  observed_at timestamptz not null,
  seconds_elapsed integer not null,
  seconds_to_close integer not null,
  current_price_dollars numeric(12, 4),
  model_above_probability numeric(12, 6),
  model_below_probability numeric(12, 6),
  action text not null check (action in ('buy_yes', 'buy_no', 'no_buy')),
  contract_side text check (contract_side in ('yes', 'no')),
  buy_price_dollars numeric(12, 4),
  fair_value_dollars numeric(12, 6),
  edge_dollars numeric(12, 6),
  confidence integer not null,
  suggested_stake_dollars numeric(12, 2) not null,
  suggested_contracts integer not null,
  features jsonb not null default '{}'::jsonb,
  reasons jsonb not null default '[]'::jsonb,
  blockers jsonb not null default '[]'::jsonb,
  explanation_status text not null check (explanation_status in ('live', 'fallback', 'disabled', 'error')),
  explanation_summary text,
  resolution_outcome text check (resolution_outcome in ('above', 'below')),
  outcome_source text check (outcome_source in ('coinbase_proxy'))
);

create index if not exists btc_signal_windows_status_idx
  on public.btc_signal_windows (status, updated_at desc);

create index if not exists btc_signal_snapshots_window_idx
  on public.btc_signal_snapshots (window_id, observed_at desc);

create index if not exists btc_signal_snapshots_market_idx
  on public.btc_signal_snapshots (market_ticker, observed_at desc);

alter table public.btc_signal_windows enable row level security;
alter table public.btc_signal_snapshots enable row level security;

drop policy if exists "btc signal windows service only" on public.btc_signal_windows;
create policy "btc signal windows service only"
  on public.btc_signal_windows
  for all
  using (false)
  with check (false);

drop policy if exists "btc signal snapshots service only" on public.btc_signal_snapshots;
create policy "btc signal snapshots service only"
  on public.btc_signal_snapshots
  for all
  using (false)
  with check (false);
