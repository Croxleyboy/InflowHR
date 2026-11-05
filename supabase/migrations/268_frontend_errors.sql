-- Frontend error tracking (F-003)
-- Purge rows older than 90 days via scheduled task or cron

create table if not exists public.frontend_errors (
  id          bigint generated always as identity primary key,
  company_id  uuid references public.companies(id) on delete set null,
  user_email  text,
  error_message text not null,
  error_stack   text,
  component_stack text,
  url         text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index idx_frontend_errors_company_created
  on public.frontend_errors (company_id, created_at desc);

alter table public.frontend_errors enable row level security;

create policy "service_role_insert"
  on public.frontend_errors for insert
  to service_role
  with check (true);

create policy "authenticated_insert"
  on public.frontend_errors for insert
  to authenticated
  with check (true);

create policy "anon_insert"
  on public.frontend_errors for insert
  to anon
  with check (true);

create policy "admin_hr_select_own_company"
  on public.frontend_errors for select
  to authenticated
  using (
    company_id is not null
    and company_id in (
      select cu.company_id from public.company_users cu
      where cu.auth_user_id = auth.uid()
        and cu.role in ('admin', 'hr')
    )
  );

create policy "super_admin_select_all"
  on public.frontend_errors for select
  to authenticated
  using (is_super_admin());
