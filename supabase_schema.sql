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
  stripe_session_id text,
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
create unique index idx_credit_ledger_stripe_session
  on credit_ledger(stripe_session_id) where stripe_session_id is not null;

-- =============================================================================
-- RPC Functions (security definer — bypasses RLS, called by backend service role)
-- =============================================================================

-- Atomically deduct one credit (only if balance > 0)
create or replace function public.deduct_credit_atomic(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  new_balance int;
begin
  update profiles
  set credits_remaining = credits_remaining - 1
  where id = p_user_id and credits_remaining > 0
  returning credits_remaining into new_balance;
  if not found then
    return -1;
  end if;
  return new_balance;
end;
$$;

-- Atomically refund one credit
create or replace function public.refund_credit(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  new_balance int;
begin
  update profiles
  set credits_remaining = credits_remaining + 1
  where id = p_user_id
  returning credits_remaining into new_balance;
  return coalesce(new_balance, -1);
end;
$$;

-- Lazy weekly credit reset (only fires if reset_at is stale)
create or replace function public.weekly_credit_reset(
  p_user_id uuid,
  p_free_credits integer,
  p_reset_threshold timestamptz
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  new_balance int;
begin
  update profiles
  set
    credits_remaining = greatest(credits_remaining, p_free_credits),
    credits_reset_at = now()
  where id = p_user_id
    and (credits_reset_at is null or credits_reset_at < p_reset_threshold)
  returning credits_remaining into new_balance;

  if not found then
    return -1;
  end if;

  return new_balance;
end;
$$;

-- Add purchased credits atomically
create or replace function public.add_purchased_credits(p_user_id uuid, p_amount integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  new_balance int;
begin
  update profiles
  set credits_remaining = credits_remaining + p_amount
  where id = p_user_id
  returning credits_remaining into new_balance;

  if not found then
    return -1;
  end if;

  return new_balance;
end;
$$;
