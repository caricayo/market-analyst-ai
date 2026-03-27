alter table public.btc_signal_executions
  drop constraint if exists btc_signal_executions_status_check;

alter table public.btc_signal_executions
  add constraint btc_signal_executions_status_check
  check (status in (
    'waiting',
    'maker_resting',
    'maker_partial',
    'submitted',
    'partial_fill',
    'unfilled',
    'skipped_no_signal',
    'error',
    'resolved'
  ));

alter table public.btc_signal_executions
  add column if not exists entry_mode text
    check (entry_mode in ('maker_first', 'taker_fallback')),
  add column if not exists resting_order_id text,
  add column if not exists resting_client_order_id text,
  add column if not exists resting_price_dollars numeric(12, 4),
  add column if not exists maker_placed_at timestamptz,
  add column if not exists maker_canceled_at timestamptz,
  add column if not exists maker_filled_contracts integer not null default 0,
  add column if not exists fallback_started_at timestamptz;
