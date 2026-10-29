-- The price history covers the products' options too: each entry keeps what every choice cost extra
-- and added for each tier at the time, and a change to the options (or their extra costs) is recorded
-- like any other price change.
--
--   product_price_history.options  [{option, choice, cost, public, client, trade}]  (in the options' order)

alter table public.product_price_history add column if not exists options jsonb not null default '[]';

-- The options' prices now: each choice with its extra cost (if entered) and what it adds per tier.
create function public.option_price_snapshot(p_product text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'option', g ->> 'name',
           'choice', v ->> 'label',
           'cost', s.option_costs -> (v ->> 'id'),
           'public', v -> 'price',
           'client', c.option_prices -> (v ->> 'id'),
           'trade', t.option_prices -> (v ->> 'id')
         ) order by gi, vi), '[]')
    from public.products p
    cross join lateral jsonb_array_elements(p.options) with ordinality as x (g, gi)
    cross join lateral jsonb_array_elements(g -> 'values') with ordinality as y (v, vi)
    left join public.product_sources s on s.id = p.id
    left join public.product_client_prices c on c.id = p.id
    left join public.product_trade_prices t on t.id = p.id
   where p.id = p_product
$$;

-- What the product's prices (and its options' prices) are based on and what they are, now.
create or replace function public.record_price(p_product text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  basis numeric;
  pub numeric;
  cli numeric;
  tra numeric;
  opts jsonb;
  last public.product_price_history;
begin
  select coalesce(s.cost, s.supplier_price) into basis from public.product_sources s where s.id = p_product;
  select price into pub from public.products where id = p_product;
  if not found then return; end if;
  select price into cli from public.product_client_prices where id = p_product;
  select price into tra from public.product_trade_prices where id = p_product;
  opts := public.option_price_snapshot(p_product);
  select * into last from public.product_price_history where product_id = p_product order by at desc, id desc limit 1;
  if found and last.public_price is not distinct from pub and last.client_price is not distinct from cli
     and last.trade_price is not distinct from tra and last.cost_basis is not distinct from basis
     and last.options is not distinct from opts then
    return;
  end if;
  insert into public.product_price_history (product_id, reason, cost_basis, public_price, client_price, trade_price, changed_by, options)
  values (p_product, left(p_reason, 120), basis, pub, cli, tra, public.current_profile_id(), opts);
end;
$$;

-- Options changed in the editor: the client and trade add-ons follow, then the change is recorded
-- once (as "Options changed", not as a hand-set price).
create or replace function public.refresh_tier_options() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  was text := coalesce(current_setting('npm.repricing', true), 'off');
begin
  if new.options is distinct from old.options then
    perform set_config('npm.repricing', 'on', true);
    update public.product_client_prices set price = price where id = new.id;
    update public.product_trade_prices set price = price where id = new.id;
    perform set_config('npm.repricing', was, true);
    if was <> 'on' then
      perform public.record_price(new.id, 'Options changed');
    end if;
  end if;
  return null;
end;
$$;

revoke execute on function public.option_price_snapshot(text) from public, anon, authenticated;

-- Products that already have options start their history with a snapshot of them.
do $$
declare
  pid text;
begin
  for pid in select id from public.products where options <> '[]' loop
    perform public.record_price(pid, 'Option prices recorded');
  end loop;
end;
$$;
