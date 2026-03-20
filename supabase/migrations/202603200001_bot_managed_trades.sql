create table if not exists public.bot_managed_trades (
  id uuid primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  market_ticker text not null,
  market_title text,
  close_time timestamptz,
  setup_type text not null check (setup_type in ('trend', 'scalp', 'reversal')),
  entry_side text not null check (entry_side in ('yes', 'no')),
  entry_outcome text not null check (entry_outcome in ('above', 'below')),
  contracts numeric(18, 6) not null,
  entry_order_id text,
  entry_client_order_id text,
  entry_price_dollars numeric(12, 4) not null,
  target_price_dollars numeric(12, 4) not null,
  stop_price_dollars numeric(12, 4) not null,
  forced_exit_at timestamptz not null,
  status text not null check (status in ('open', 'exit-submitted', 'closed', 'error')),
  exit_reason text check (exit_reason in ('target', 'stop', 'time', 'manual-sync', 'expired', 'unknown')),
  exit_order_id text,
  exit_client_order_id text,
  exit_price_dollars numeric(12, 4),
  realized_pnl_dollars numeric(12, 4),
  last_seen_bid_dollars numeric(12, 4),
  peak_price_dollars numeric(12, 4),
  last_checked_at timestamptz,
  last_exit_attempt_at timestamptz,
  stop_armed_at timestamptz,
  error_message text
);

create index if not exists bot_managed_trades_status_idx
  on public.bot_managed_trades (status, updated_at desc);

create index if not exists bot_managed_trades_market_ticker_idx
  on public.bot_managed_trades (market_ticker, updated_at desc);

alter table public.bot_managed_trades enable row level security;

drop policy if exists "bot managed trades service only" on public.bot_managed_trades;
create policy "bot managed trades service only"
  on public.bot_managed_trades
  for all
  using (false)
  with check (false);
