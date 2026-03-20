create table if not exists public.bot_research_windows (
  id uuid primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  market_ticker text not null unique,
  close_time timestamptz,
  observed_at timestamptz not null,
  minute_in_window integer not null,
  strike_price_dollars numeric(12, 4),
  current_price_dollars numeric(12, 4),
  yes_ask_price_dollars numeric(12, 4),
  no_ask_price_dollars numeric(12, 4),
  yes_bid_price_dollars numeric(12, 4),
  no_bid_price_dollars numeric(12, 4),
  timing_risk text not null,
  indicators jsonb not null default '{}'::jsonb,
  champion_policy_slug text not null,
  status text not null check (status in ('pending', 'resolved')),
  resolution_outcome text check (resolution_outcome in ('above', 'below')),
  settlement_price_dollars numeric(12, 4),
  resolved_at timestamptz
);

create table if not exists public.bot_policy_evaluations (
  id uuid primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  window_id uuid not null references public.bot_research_windows(id) on delete cascade,
  market_ticker text not null,
  policy_slug text not null,
  policy_name text not null,
  is_champion boolean not null default false,
  setup_type text not null,
  call text not null,
  candidate_side text,
  should_trade boolean not null default false,
  confidence integer not null,
  entry_side text,
  entry_price_dollars numeric(12, 4),
  contracts numeric(18, 6),
  max_cost_dollars numeric(12, 4),
  gate_reasons jsonb not null default '[]'::jsonb,
  blockers jsonb not null default '[]'::jsonb,
  status text not null check (status in ('pending', 'resolved', 'skipped')),
  resolution_outcome text check (resolution_outcome in ('above', 'below')),
  settlement_price_dollars numeric(12, 4),
  paper_pnl_dollars numeric(12, 4),
  resolved_at timestamptz,
  unique (window_id, policy_slug)
);

create index if not exists bot_research_windows_status_idx
  on public.bot_research_windows (status, close_time desc);

create index if not exists bot_policy_evaluations_policy_idx
  on public.bot_policy_evaluations (policy_slug, status, updated_at desc);

alter table public.bot_research_windows enable row level security;
alter table public.bot_policy_evaluations enable row level security;

drop policy if exists "bot research windows service only" on public.bot_research_windows;
create policy "bot research windows service only"
  on public.bot_research_windows
  for all
  using (false)
  with check (false);

drop policy if exists "bot policy evaluations service only" on public.bot_policy_evaluations;
create policy "bot policy evaluations service only"
  on public.bot_policy_evaluations
  for all
  using (false)
  with check (false);
