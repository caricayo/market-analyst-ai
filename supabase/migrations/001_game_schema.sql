-- Game schema for Mystic Atlas RPG

create table if not exists public.game_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.game_saves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.game_profiles(id) on delete cascade,
  run_id text not null,
  save_version int not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  unique(user_id, run_id)
);

create table if not exists public.game_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.game_profiles(id) on delete cascade,
  arc_id text not null,
  ending_id text not null,
  score int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.game_profiles enable row level security;
alter table public.game_saves enable row level security;
alter table public.game_scores enable row level security;

create policy if not exists "profiles_select_own" on public.game_profiles
  for select using (auth.uid() = id);

create policy if not exists "saves_select_own" on public.game_saves
  for select using (auth.uid() = user_id);

create policy if not exists "saves_upsert_own" on public.game_saves
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists "scores_read_all" on public.game_scores
  for select using (true);

create policy if not exists "scores_insert_own" on public.game_scores
  for insert with check (auth.uid() = user_id);

create or replace function public.handle_new_game_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.game_profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_game_user_created on auth.users;
create trigger on_auth_game_user_created
  after insert on auth.users
  for each row execute function public.handle_new_game_user();
