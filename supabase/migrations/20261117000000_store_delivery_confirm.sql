-- Delivery orders: the office confirms the delivery cost and date before the customer is invoiced,
-- so the customer only pays once they've agreed them (same-day, or the earliest date offered).
-- Pickup orders are invoiced straight away, as before.

alter table public.orders
  add column delivery_fee numeric(12,2) check (delivery_fee >= 0 and delivery_fee <= 10000),
  add column delivery_note text not null default '' check (length(delivery_note) <= 200);
comment on column public.orders.delivery_fee is 'Delivery cost inc. GST, confirmed by the office (null until then). Invoiced on top of total.';
comment on column public.orders.delivery_note is 'The confirmed delivery date, e.g. "Same day, Tue 12 Nov" or "Earliest: Thu 14 Nov".';

-- Only confirm_order_delivery (security definer) or the server sets them; the app can't.
create or replace function public.guard_order_delivery() returns trigger
language plpgsql set search_path = '' as $$
begin
  if public.is_api_user() then
    if tg_op = 'INSERT' then
      new.delivery_fee := null; new.delivery_note := '';
    else
      new.delivery_fee := old.delivery_fee; new.delivery_note := old.delivery_note;
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_order_delivery before insert or update on public.orders
  for each row execute function public.guard_order_delivery();
revoke execute on function public.guard_order_delivery() from public, anon, authenticated;

create or replace function public.claim_order_invoices(max_rows int default 5)
returns setof public.orders
language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
  lim_daily int;
  lim_max numeric;
  used int;
  why text;
begin
  select coalesce(auto_daily_limit, 20), coalesce(auto_max_total, 5000) into lim_daily, lim_max from public.qbo_connection where id = 1;
  lim_daily := coalesce(lim_daily, 20);
  lim_max := coalesce(lim_max, 5000);
  -- One claim at a time, so the day's count can't be overtaken by two runs at once.
  perform pg_advisory_xact_lock(hashtext('claim_order_invoices'));
  select count(*) into used from public.orders where invoice_auto_at > now() - interval '24 hours';
  for o in
    select * from public.orders
     where invoice_next_try <= now() and status <> 'cancelled'
       and (invoice_status = 'pending' or (invoice_status = 'failed' and invoice_attempts < 6) or invoice_status = 'working')
     order by created_at
     limit max_rows
     for update skip locked
  loop
    -- Delivery orders wait for the office to confirm the delivery cost and date (the customer only
    -- pays once they've agreed them), however they were approved: see confirm_order_delivery.
    if o.invoice_status = 'pending' and o.delivery <> 'pickup' and o.delivery_fee is null then
      update public.orders set invoice_status = 'held', invoice_approved = false,
             invoice_error = 'Confirm the delivery cost and date, then click Approve and invoice.' where id = o.id;
      insert into public.inbox (user_id, title, body)
        select id, 'Order #' || o.number || ': confirm its delivery',
               'Work out the delivery cost and date for order #' || o.number || ' (' || o.name || ', ' || o.address
                 || '), then open it in Admin → Store → Orders, enter them and click Approve and invoice. The customer''s invoice includes them.'
          from public.profiles
         where role = 'admin' and status = 'active' and 'canManageStore' = any (permissions);
      continue;
    end if;
    if o.invoice_status = 'pending' and not o.invoice_approved and o.invoice_auto_at is null then
      why := case
        when o.total > lim_max then 'Over the $' || to_char(lim_max, 'FM999,999,990.00') || ' limit for automatic invoices'
        when used >= lim_daily then 'The day’s ' || lim_daily || ' automatic invoices have been sent'
      end;
      if why is not null then
        update public.orders set invoice_status = 'held', invoice_error = why || ': approve it to send the invoice.' where id = o.id;
        insert into public.inbox (user_id, title, body)
          select id, 'Order #' || o.number || ': approve its invoice',
                 why || '. Open the order (Admin → Store → Orders) and click Approve and invoice to send its QuickBooks invoice.'
            from public.profiles
           where role = 'admin' and status = 'active' and 'canManageStore' = any (permissions);
        continue;
      end if;
      used := used + 1;
      update public.orders set invoice_auto_at = now() where id = o.id;
      o.invoice_auto_at := now();
    end if;
    update public.orders set invoice_status = 'working', invoice_next_try = now() + interval '10 minutes' where id = o.id;
    o.invoice_status := 'working';
    return next o;
  end loop;
end;
$$;

-- The office confirms a delivery order's cost and date and approves its invoice, which then
-- includes the delivery. Before the invoice is made only; afterwards, change it in QuickBooks.
create or replace function public.confirm_order_delivery(p_id text, p_fee numeric, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
begin
  if not public.has_perm('canManageStore') then raise exception 'You need the “Manage store & orders” permission'; end if;
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'That order wasn''t found'; end if;
  if o.delivery = 'pickup' then raise exception 'This order is for pickup: there''s no delivery to confirm'; end if;
  if o.status = 'cancelled' then raise exception 'This order is cancelled'; end if;
  if o.qbo_invoice_id is not null or o.invoice_status in ('working', 'sent', 'paid', 'voided', 'refund_needed') then
    raise exception 'Its invoice has already been made. Change the delivery in QuickBooks instead.';
  end if;
  p_note := btrim(coalesce(p_note, ''));
  if p_fee is null or p_fee < 0 or p_fee > 10000 then raise exception 'Enter the delivery cost (0 to 10,000)'; end if;
  if p_note = '' then raise exception 'Enter the delivery date, e.g. "Same day, Tue 12 Nov" or "Earliest: Thu 14 Nov"'; end if;
  if length(p_note) > 200 then raise exception 'Keep the delivery date under 200 characters'; end if;
  update public.orders set delivery_fee = round(p_fee, 2), delivery_note = p_note where id = p_id;
  -- Approved: invoiced now (whatever the automatic limits), with the delivery on it.
  update public.orders set invoice_status = 'pending', invoice_attempts = 0, invoice_next_try = now(), invoice_error = '',
                           invoice_approved = true
   where id = p_id;
  perform public.kick_quickbooks();
end;
$$;
revoke execute on function public.confirm_order_delivery(text, numeric, text) from public, anon;
grant execute on function public.confirm_order_delivery(text, numeric, text) to authenticated;
