-- Migration 002: Atomic credit deduction RPC function
-- Run this in the Supabase SQL Editor.

-- Atomically deduct one credit. Returns new balance, or -1 if no credits available.
create or replace function public.deduct_credit_atomic(p_user_id uuid)
returns int
language plpgsql
security definer
set search_path = public
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

-- Atomically refund one credit (e.g. on pipeline error).
create or replace function public.refund_credit(p_user_id uuid)
returns int
language plpgsql
security definer
set search_path = public
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
