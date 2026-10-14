-- schema-v58: PayPal as a second payment option (alongside Square)
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run twice.
--
-- Checkout rows keep using the existing square_order_id / square_checkout_url
-- / square_payment_id columns for whichever provider issued them (a PayPal
-- order id / approve link / capture id go in the same places); this column
-- says which provider it was, so refunds and the staff pages know where the
-- money is. Clinic balance links get their own flag because a balance can
-- be paid through either provider independently of the deposit.

alter table registrations add column if not exists payment_provider text not null default 'square';
alter table registrations add column if not exists balance_payment_provider text;

do $$
begin
  if to_regclass('public.club_members') is not null then
    execute 'alter table club_members add column if not exists payment_provider text not null default ''square''';
  end if;
  if to_regclass('public.raffle_orders') is not null then
    execute 'alter table raffle_orders add column if not exists payment_provider text not null default ''square''';
  end if;
end $$;
