-- Performance goals: managers set goals for their direct reports
create table if not exists performance_goals (
  id uuid default gen_random_uuid() primary key,
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  manager_id uuid not null references employees(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'active' check (status in ('active','completed','edited','on_hold','cancelled')),
  grade smallint check (grade is null or (grade >= 1 and grade <= 10)),
  start_date date not null default current_date,
  due_date date,
  completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_perf_goals_company on performance_goals(company_id);
create index if not exists idx_perf_goals_employee on performance_goals(employee_id);
create index if not exists idx_perf_goals_manager on performance_goals(manager_id);

alter table performance_goals enable row level security;

create policy "perf_goals_read" on performance_goals for select using (
  company_id in (select company_id from company_users where auth_user_id = auth.uid() and is_active = true)
);

create policy "perf_goals_insert" on performance_goals for insert with check (
  company_id in (select company_id from company_users where auth_user_id = auth.uid() and is_active = true)
);

create policy "perf_goals_update" on performance_goals for update using (
  company_id in (select company_id from company_users where auth_user_id = auth.uid() and is_active = true)
);

create policy "perf_goals_delete" on performance_goals for delete using (
  company_id in (select company_id from company_users where auth_user_id = auth.uid() and is_active = true)
);
