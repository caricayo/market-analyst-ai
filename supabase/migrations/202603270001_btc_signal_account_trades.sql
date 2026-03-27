create table if not exists public.btc_signal_account_trades (
  id uuid primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  market_ticker text not null,
  side text not null check (side in ('yes', 'no')),
  source text not null check (source in ('manual', 'auto', 'mixed', 'unknown')),
  first_fill_at timestamptz,
  last_fill_at timestamptz,
  total_contracts integer not null default 0,
  average_price_dollars numeric(12, 4),
  fills_count integer not null default 0,
  resolution_outcome text check (resolution_outcome in ('above', 'below')),
  result text not null check (result in ('win', 'loss', 'open')),
  realized_pnl_dollars numeric(12, 2),
  unique (market_ticker, side)
);

create index if not exists btc_signal_account_trades_updated_idx
  on public.btc_signal_account_trades (updated_at desc);

create index if not exists btc_signal_account_trades_fill_idx
  on public.btc_signal_account_trades (first_fill_at desc, source);

alter table public.btc_signal_account_trades enable row level security;

drop policy if exists "btc signal account trades service only" on public.btc_signal_account_trades;
create policy "btc signal account trades service only"
  on public.btc_signal_account_trades
  for all
  using (false)
  with check (false);
