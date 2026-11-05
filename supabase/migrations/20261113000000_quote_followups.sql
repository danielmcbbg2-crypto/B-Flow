-- Automatic follow-up texts for unanswered quotes (off until the office switches them on in Text
-- messages → Automatic texts). Each morning, the client of every issued quote that hasn't been
-- answered gets a friendly text with the quote's link, a set number of days after it was issued
-- (3 and 7 to start), through the SMS outbox, so ClickSend sends it from the business's mobile.
--
-- At most one a day per quote, none once someone followed it up in the last 2 days (by hand or
-- automatically), none after the quote expires, and each step once per issue of the quote
-- (dedupe_key). Sending one counts as a follow-up on the Quotes board.

update public.settings
   set sms = coalesce(sms, '{}'::jsonb)
     || jsonb_build_object(
          'quoteFollowUps', coalesce((sms->>'quoteFollowUps')::boolean, false),
          'quoteFollowUpDays', coalesce(sms->'quoteFollowUpDays', '[3, 7]'::jsonb),
          'quoteFollowUpMessage', coalesce(sms->>'quoteFollowUpMessage',
            'Hi {first_name}, it''s Daniel from Next Phase Maintenance. Just checking you got our quote for {title}: {amount} inc. GST{valid_until}. You can read it and accept it here: {link} Happy to answer any questions.'))
 where id = 1;

create or replace function public.send_quote_followups(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  s jsonb := coalesce((select sms from public.settings where id = 1), '{}'::jsonb);
  steps int[] := coalesce((select array_agg(x::int order by x::int) from jsonb_array_elements_text(coalesce(s->'quoteFollowUpDays', '[3, 7]'::jsonb)) x where x ~ '^[0-9]{1,3}$' and x::int > 0), '{3,7}');
  template text := coalesce(nullif(btrim(s->>'quoteFollowUpMessage'), ''),
    'Hi {first_name}, it''s Daniel from Next Phase Maintenance. Just checking you got our quote for {title}: {amount} inc. GST{valid_until}. You can read it and accept it here: {link} Happy to answer any questions.');
  today date := (p_now at time zone 'Australia/Melbourne')::date;
  q record;
  step int;
  days int;
  msg text;
  sent integer := 0;
begin
  if not coalesce((s->>'quoteFollowUps')::boolean, false) then return 0; end if;
  for q in
    select p.id, p.number, p.title, p.quote_token, p.quote_issued_at, p.quote_valid_until, p.quote_followed_up_at,
           c.name, c.phone, public.quote_total_inc_gst(p.id) as total
      from public.projects p
      join public.profiles c on c.id = p.client_id
     where p.status = 'quoted' and p.quote_token is not null and p.quote_issued_at is not null
       and c.status <> 'suspended' and coalesce(btrim(c.phone), '') <> ''
       and (p.quote_valid_until is null or p.quote_valid_until >= today)
       and (p.quote_followed_up_at is null or p.quote_followed_up_at < p_now - interval '2 days')
  loop
    days := today - (q.quote_issued_at at time zone 'Australia/Melbourne')::date;
    -- The latest step that's due; earlier ones that were missed aren't sent as well.
    select max(i) into step from generate_subscripts(steps, 1) i where steps[i] <= days;
    if step is null then continue; end if;
    msg := replace(replace(replace(replace(replace(template,
             '{first_name}', coalesce(nullif(split_part(btrim(q.name), ' ', 1), ''), 'there')),
             '{title}', q.title),
             '{amount}', '$' || to_char(q.total, 'FM999,999,990.00')),
             '{valid_until}', case when q.quote_valid_until is null then '' else ', valid until ' || to_char(q.quote_valid_until, 'FMDD/FMMM/YYYY') end),
             '{link}', 'https://portal.nextphasemaintenance.com.au/#/quote/' || q.quote_token);
    insert into public.sms_outbox (to_phone, message, event, source, dedupe_key)
    values (q.phone, left(msg, 480), 'Quote follow-up · P-' || q.number || ' · ' || step, 'quote_followup',
            'quote-followup:' || q.id || ':' || extract(epoch from q.quote_issued_at)::bigint || ':' || step)
    on conflict (dedupe_key) do nothing;
    if found then
      update public.projects set quote_followed_up_at = p_now where id = q.id;
      sent := sent + 1;
    end if;
  end loop;
  return sent;
end;
$$;
revoke execute on function public.send_quote_followups(timestamptz) from public, anon, authenticated;

-- Every morning at 10 (9 in winter), Melbourne time.
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('quote-followups', '0 23 * * *', 'select public.send_quote_followups()');
  end if;
end;
$do$;
