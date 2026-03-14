create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  timezone text default 'Pacific/Honolulu',
  created_at timestamptz not null default now()
);

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  event_date date not null,
  event_time time not null,
  reminder_minutes integer not null default 30,
  category text not null default 'Personal',
  created_at timestamptz not null default now()
);

create table if not exists public.recurring_bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  amount numeric(12, 2) not null,
  due_day integer not null check (due_day between 1 and 28),
  cadence_months integer not null default 1 check (cadence_months in (1, 3, 12)),
  starts_at date not null,
  autopay boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.stock_watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null,
  company text not null,
  thesis text,
  created_at timestamptz not null default now(),
  unique (user_id, ticker)
);

alter table public.profiles enable row level security;
alter table public.calendar_events enable row level security;
alter table public.recurring_bills enable row level security;
alter table public.stock_watchlist enable row level security;

create policy "profiles owner only" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "events owner only" on public.calendar_events for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "bills owner only" on public.recurring_bills for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "watchlist owner only" on public.stock_watchlist for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
