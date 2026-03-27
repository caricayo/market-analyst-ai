create table if not exists public.btc_signal_control_state (
  scope text primary key,
  mode text not null check (mode in ('running', 'stopped')),
  reason text null check (reason in ('manual_stop', 'insufficient_funds')),
  message text not null,
  updated_by text null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.btc_signal_control_state enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'btc_signal_control_state'
      and policyname = 'Service role manages btc signal control state'
  ) then
    create policy "Service role manages btc signal control state"
      on public.btc_signal_control_state
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end
$$;

insert into public.btc_signal_control_state (scope, mode, reason, message)
values ('btc_signal_live', 'running', null, 'Auto-execution is live.')
on conflict (scope) do nothing;
