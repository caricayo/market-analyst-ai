-- Migration 003: Additional atomic credit RPCs
-- Run this in the Supabase SQL Editor.

-- Atomically add purchased credits. Returns new balance, or -1 if profile not found.
create or replace function public.add_purchased_credits(p_user_id uuid, p_amount int)
returns int
language plpgsql
security definer
set search_path = public
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

-- Atomically reset weekly credits. Returns new balance, or -1 if not eligible/not found.
-- Only resets if credits_reset_at is null or older than the provided threshold.
create or replace function public.weekly_credit_reset(
  p_user_id uuid,
  p_free_credits int,
  p_reset_threshold timestamptz
)
returns int
language plpgsql
security definer
set search_path = public
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
