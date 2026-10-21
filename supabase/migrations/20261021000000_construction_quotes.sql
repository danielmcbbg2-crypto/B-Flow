-- Construction management: itemised quotes, variations, progress payments and project costs.
--
-- Prices are entered excluding GST and shown with GST added. The client sees their project's quote
-- breakdown once it's issued, their variations (and approves or declines proposed ones) and their
-- payment schedule. Costs and margin are for the office only. Assigned trades see none of these.

-- Quote terms on the project.
alter table public.projects
  add column quote_inclusions  text not null default '',
  add column quote_exclusions  text not null default '',
  add column quote_valid_until date;

-- Quote line items, grouped into sections (stages or trades).
create table public.project_quote_items (
  id          text primary key default gen_random_uuid()::text,
  project_id  text not null references public.projects (id) on delete cascade,
  position    integer not null default 0,
  section     text not null default '',
  description text not null,
  kind        text not null default 'labour' check (kind in ('labour', 'materials', 'subcontract', 'hire', 'other')),
  qty         numeric(12, 2) not null default 1 check (qty >= 0),
  unit        text not null default '',
  rate        numeric(12, 2) not null default 0 check (rate >= 0)
);

-- Variations: priced changes after the quote, which the client approves or declines.
create table public.project_variations (
  id          text primary key default gen_random_uuid()::text,
  project_id  text not null references public.projects (id) on delete cascade,
  number      integer not null,
  title       text not null,
  description text not null default '',
  amount      numeric(12, 2) not null check (amount <> 0),
  status      text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected')),
  created_at  timestamptz not null default now(),
  created_by  text references public.profiles (id) on delete set null,
  decided_by  text references public.profiles (id) on delete set null,
  decided_at  timestamptz,
  unique (project_id, number)
);

-- Progress payments: deposit, stage claims and the final balance. A claim is raised as an invoice.
create table public.project_payments (
  id           text primary key default gen_random_uuid()::text,
  project_id   text not null references public.projects (id) on delete cascade,
  position     integer not null default 0,
  title        text not null,
  -- percent: of the quoted total; amount: a fixed sum inc. GST; balance: whatever is left of the
  -- contract (quote plus approved variations) after the other stages.
  basis        text not null default 'percent' check (basis in ('percent', 'amount', 'balance')),
  value        numeric(12, 2) not null default 0 check (value >= 0),
  milestone_id text references public.project_milestones (id) on delete set null,
  invoice_id   text references public.invoices (id) on delete set null
);

-- Other project costs (materials, hire, subcontractors…) besides trades' expenses. Office only.
create table public.project_costs (
  id          text primary key default gen_random_uuid()::text,
  project_id  text not null references public.projects (id) on delete cascade,
  date        date not null,
  description text not null,
  category    text not null default 'Materials',
  supplier    text not null default '',
  amount      numeric(12, 2) not null check (amount >= 0)
);

create index on public.project_quote_items (project_id);
create index on public.project_variations (project_id);
create index on public.project_payments (project_id);
create index on public.project_costs (project_id);

alter table public.project_quote_items enable row level security;
alter table public.project_variations enable row level security;
alter table public.project_payments enable row level security;
alter table public.project_costs enable row level security;

-- The client sees the breakdown once the quote is issued (not while it's being prepared).
create policy quote_items_select on public.project_quote_items for select to authenticated using (
  has_perm('canManageProjects')
  or exists (select 1 from public.projects p where p.id = project_id and p.client_id = current_profile_id() and p.status <> 'quote_requested')
);
create policy quote_items_insert on public.project_quote_items for insert to authenticated with check (has_perm('canManageProjects'));
create policy quote_items_update on public.project_quote_items for update to authenticated using (has_perm('canManageProjects'));
create policy quote_items_delete on public.project_quote_items for delete to authenticated using (has_perm('canManageProjects'));

create policy variations_select on public.project_variations for select to authenticated using (
  has_perm('canManageProjects') or exists (select 1 from public.projects p where p.id = project_id and p.client_id = current_profile_id())
);
create policy variations_insert on public.project_variations for insert to authenticated with check (has_perm('canManageProjects'));
create policy variations_update on public.project_variations for update to authenticated using (
  has_perm('canManageProjects') or exists (select 1 from public.projects p where p.id = project_id and p.client_id = current_profile_id())
);
create policy variations_delete on public.project_variations for delete to authenticated using (has_perm('canManageProjects') and status = 'proposed');

create policy payments_select on public.project_payments for select to authenticated using (
  has_perm('canManageProjects') or exists (select 1 from public.projects p where p.id = project_id and p.client_id = current_profile_id())
);
create policy payments_insert on public.project_payments for insert to authenticated with check (has_perm('canManageProjects'));
create policy payments_update on public.project_payments for update to authenticated using (has_perm('canManageProjects'));
create policy payments_delete on public.project_payments for delete to authenticated using (has_perm('canManageProjects') and invoice_id is null);

create policy costs_select on public.project_costs for select to authenticated using (has_perm('canManageProjects'));
create policy costs_insert on public.project_costs for insert to authenticated with check (has_perm('canManageProjects'));
create policy costs_update on public.project_costs for update to authenticated using (has_perm('canManageProjects'));
create policy costs_delete on public.project_costs for delete to authenticated using (has_perm('canManageProjects'));

-- Variations: the database records who proposed and who decided (the signed-in person, so an admin
-- working in a client's dashboard is recorded as the admin). A client may only approve or decline a
-- proposed variation; a decided one stays as it is.
create function public.guard_variation() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not public.is_api_user() then return new; end if;
  if tg_op = 'INSERT' then
    new.created_by := public.current_profile_id();
    new.status := 'proposed';
    new.decided_by := null;
    new.decided_at := null;
    return new;
  end if;
  new.created_by := old.created_by;
  if not public.has_perm('canManageProjects') then
    if (to_jsonb(new) - array['status', 'decided_by', 'decided_at']) is distinct from (to_jsonb(old) - array['status', 'decided_by', 'decided_at'])
       or old.status <> 'proposed' or new.status not in ('approved', 'rejected') then
      raise exception 'Clients can only approve or decline a proposed variation';
    end if;
  elsif old.status <> 'proposed' and (to_jsonb(new) - array['decided_by', 'decided_at']) is distinct from (to_jsonb(old) - array['decided_by', 'decided_at']) then
    raise exception 'A variation that has been approved or declined can’t be changed; add a new one';
  end if;
  if new.status is distinct from old.status then
    new.decided_by := public.current_profile_id();
    new.decided_at := now();
  else
    new.decided_by := old.decided_by;
    new.decided_at := old.decided_at;
  end if;
  return new;
end;
$$;
create trigger guard_variation before insert or update on public.project_variations
  for each row execute function public.guard_variation();
revoke execute on function public.guard_variation() from public, anon, authenticated;

-- A payment stage that has been claimed keeps its amount basis (the invoice is the record).
create function public.guard_payment_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not public.is_api_user() then return new; end if;
  if old.invoice_id is not null and ((to_jsonb(new) - array['position', 'title', 'milestone_id']) is distinct from (to_jsonb(old) - array['position', 'title', 'milestone_id'])) then
    raise exception 'This payment has been claimed; change its invoice in Finance instead';
  end if;
  return new;
end;
$$;
create trigger guard_payment_update before update on public.project_payments
  for each row execute function public.guard_payment_update();
revoke execute on function public.guard_payment_update() from public, anon, authenticated;

-- Accounts that proposed or decided variations keep their history (as for quotes).
create or replace function public.keep_account_history() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.requests where client_id = old.id)
     or exists (select 1 from public.projects where client_id = old.id) then
    raise exception 'This account has jobs or invoices on record, so it can’t be deleted. Suspend it instead.'
      using errcode = '23503';
  end if;
  if exists (select 1 from public.requests where created_by = old.id and client_id <> old.id)
     or exists (select 1 from public.projects where client_id <> old.id and (created_by = old.id or quote_decided_by = old.id))
     or exists (select 1 from public.project_expenses where created_by = old.id and provider_id is distinct from old.id)
     or exists (select 1 from public.inbox where acknowledged_by = old.id and user_id <> old.id)
     or exists (select 1 from public.project_variations v join public.projects p on p.id = v.project_id
                where p.client_id <> old.id and (v.created_by = old.id or v.decided_by = old.id)) then
    raise exception 'This account has done work for other people on record, so it can’t be deleted. Suspend it instead.'
      using errcode = '23503';
  end if;
  return old;
end;
$$;

alter publication supabase_realtime add table
  public.project_quote_items, public.project_variations, public.project_payments, public.project_costs;
