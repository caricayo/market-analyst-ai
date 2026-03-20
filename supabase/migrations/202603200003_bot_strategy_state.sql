create table if not exists public.bot_strategy_state (
  scope text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  active_policy_slug text not null,
  active_policy_name text not null,
  source text not null default 'default',
  notes text,
  changed_at timestamptz not null default now()
);

create table if not exists public.bot_strategy_changes (
  id uuid primary key,
  created_at timestamptz not null default now(),
  from_policy_slug text,
  from_policy_name text,
  to_policy_slug text not null,
  to_policy_name text not null,
  source text not null,
  reason text,
  promoted_at timestamptz not null default now()
);

alter table public.bot_research_windows
  add column if not exists champion_policy_name text;

alter table public.bot_policy_evaluations
  add column if not exists replay_mode text not null default 'resolution';

alter table public.bot_policy_evaluations
  add column if not exists exit_reason text;

alter table public.bot_policy_evaluations
  add column if not exists exit_price_dollars numeric(12, 4);

alter table public.bot_policy_evaluations
  add column if not exists exit_at timestamptz;

create index if not exists bot_strategy_changes_promoted_idx
  on public.bot_strategy_changes (promoted_at desc);

alter table public.bot_strategy_state enable row level security;
alter table public.bot_strategy_changes enable row level security;

drop policy if exists "bot strategy state service only" on public.bot_strategy_state;
create policy "bot strategy state service only"
  on public.bot_strategy_state
  for all
  using (false)
  with check (false);

drop policy if exists "bot strategy changes service only" on public.bot_strategy_changes;
create policy "bot strategy changes service only"
  on public.bot_strategy_changes
  for all
  using (false)
  with check (false);
