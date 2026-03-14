create table if not exists public.saved_articles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  article_id text not null,
  created_at timestamptz not null default now(),
  unique (user_id, article_id)
);

create table if not exists public.bill_payment_cycles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recurring_bill_id uuid not null references public.recurring_bills(id) on delete cascade,
  due_date date not null,
  paid_at timestamptz not null default now(),
  unique (user_id, recurring_bill_id, due_date)
);

create table if not exists public.stock_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null,
  target_price numeric(12, 2) not null,
  created_at timestamptz not null default now(),
  unique (user_id, ticker)
);

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  selected_city text,
  compare_city text,
  news_filters text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.saved_articles enable row level security;
alter table public.bill_payment_cycles enable row level security;
alter table public.stock_alerts enable row level security;
alter table public.user_preferences enable row level security;

create policy "saved articles owner only" on public.saved_articles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "bill payment cycles owner only" on public.bill_payment_cycles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "stock alerts owner only" on public.stock_alerts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "user preferences owner only" on public.user_preferences for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
