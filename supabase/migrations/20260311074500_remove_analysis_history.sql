alter table if exists public.credit_ledger
drop constraint if exists credit_ledger_analysis_id_fkey;

alter table if exists public.credit_ledger
drop column if exists analysis_id;

drop table if exists public.analyses cascade;
