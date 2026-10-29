-- Performance housekeeping (from Supabase's advisors): access rules work out the signed-in user once
-- per query rather than once per row, foreign keys get indexes, and the two rate-limit tables get
-- primary keys.
--
-- Already applied to the live project as "perf_rls_initplan_fks_pks"; this is the same change,
-- written so it can run again harmlessly.

-- 1. RLS: evaluate auth.uid() once per query, not per row
alter policy profiles_select on public.profiles using (
  (auth_id = (select auth.uid())) OR is_admin()
  OR EXISTS (SELECT 1 FROM requests r WHERE ((r.client_id = current_profile_id()) AND (r.assigned_provider_id = profiles.id)) OR ((r.assigned_provider_id = current_profile_id()) AND (r.client_id = profiles.id)))
  OR EXISTS (SELECT 1 FROM projects p WHERE ((p.client_id = current_profile_id()) AND (p.assigned_provider_id = profiles.id)) OR ((p.assigned_provider_id = current_profile_id()) AND (p.client_id = profiles.id)))
);
alter policy "Admins read outbox" on public.sms_outbox using (
  EXISTS (SELECT 1 FROM profiles p WHERE p.auth_id = (select auth.uid()) AND p.role = 'admin' AND p.status = 'active')
);
alter policy "Admins queue texts" on public.sms_outbox with check (
  EXISTS (SELECT 1 FROM profiles p WHERE p.auth_id = (select auth.uid()) AND p.role = 'admin' AND p.status = 'active')
);

-- 2. Index foreign keys
create index if not exists project_expenses_provider_id_idx on public.project_expenses(provider_id);
create index if not exists project_expenses_created_by_idx on public.project_expenses(created_by);
create index if not exists invoices_request_id_idx on public.invoices(request_id);
create index if not exists invoices_project_id_idx on public.invoices(project_id);
create index if not exists requests_property_id_idx on public.requests(property_id);
create index if not exists requests_created_by_idx on public.requests(created_by);
create index if not exists projects_property_id_idx on public.projects(property_id);
create index if not exists projects_created_by_idx on public.projects(created_by);
create index if not exists projects_quote_decided_by_idx on public.projects(quote_decided_by);
create index if not exists inbox_request_id_idx on public.inbox(request_id);
create index if not exists inbox_project_id_idx on public.inbox(project_id);
create index if not exists inbox_acknowledged_by_idx on public.inbox(acknowledged_by);
create index if not exists products_created_by_idx on public.products(created_by);
create index if not exists order_items_product_id_idx on public.order_items(product_id);
create index if not exists project_variations_created_by_idx on public.project_variations(created_by);
create index if not exists project_variations_decided_by_idx on public.project_variations(decided_by);
create index if not exists project_payments_milestone_id_idx on public.project_payments(milestone_id);
create index if not exists project_payments_invoice_id_idx on public.project_payments(invoice_id);
create index if not exists leads_client_id_idx on public.leads(client_id);
create index if not exists text_log_opened_by_idx on public.text_log(opened_by);
create index if not exists project_diary_author_id_idx on public.project_diary(author_id);
create index if not exists project_defects_assignee_id_idx on public.project_defects(assignee_id);
create index if not exists project_defects_raised_by_idx on public.project_defects(raised_by);
create index if not exists project_defects_fixed_by_idx on public.project_defects(fixed_by);
create index if not exists project_defects_closed_by_idx on public.project_defects(closed_by);
create index if not exists project_documents_uploaded_by_idx on public.project_documents(uploaded_by);
create index if not exists reminder_log_recipient_id_idx on public.reminder_log(recipient_id);
create index if not exists sms_outbox_lead_id_idx on public.sms_outbox(lead_id);

-- 3. Primary keys
alter table public.lead_attempts add column if not exists id bigint generated always as identity primary key;
alter table public.order_attempts add column if not exists id bigint generated always as identity primary key;
