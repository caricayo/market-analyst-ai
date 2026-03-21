alter table public.bot_managed_trades
  add column if not exists entry_tier_dollars numeric,
  add column if not exists target_tier_dollars numeric,
  add column if not exists stop_tier_dollars numeric,
  add column if not exists confidence_band text;

alter table public.bot_managed_trades
  drop constraint if exists bot_managed_trades_confidence_band_check;

alter table public.bot_managed_trades
  add constraint bot_managed_trades_confidence_band_check
  check (
    confidence_band is null
    or confidence_band = any (array['low'::text, 'mid'::text, 'high'::text])
  );
