-- TriView Capital / arfour — Supabase Schema
-- Run this in the Supabase SQL Editor to set up the database.

-- User profiles (extends Supabase auth.users)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  tier text not null default 'free',
  credits_remaining int not null default 3,
  credits_reset_at timestamptz,
  stripe_customer_id text,
  created_at timestamptz default now()
);

-- Analysis results
create table analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  ticker text not null,
  status text not null default 'running',
  result jsonb,
  cost_usd numeric(6,4),
  created_at timestamptz default now()
);

-- Credit transaction ledger
create table credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  delta int not null,
  reason text not null,
  analysis_id uuid references analyses(id),
  created_at timestamptz default now()
);

-- Row Level Security
alter table profiles enable row level security;
alter table analyses enable row level security;
alter table credit_ledger enable row level security;

-- RLS policies
create policy "Users read own profile"
  on profiles for select
  using (auth.uid() = id);

create policy "Users update own profile"
  on profiles for update
  using (auth.uid() = id);

create policy "Users read own analyses"
  on analyses for select
  using (auth.uid() = user_id);

create policy "Users read own ledger"
  on credit_ledger for select
  using (auth.uid() = user_id);

-- Auto-create profile on user signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, tier, credits_remaining)
  values (new.id, 'free', 3);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Indexes for common queries
create index idx_analyses_user_id on analyses(user_id);
create index idx_analyses_created_at on analyses(created_at desc);
create index idx_credit_ledger_user_id on credit_ledger(user_id);
