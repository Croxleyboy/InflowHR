-- Labour demand: staffing requirements per shift template per day of week
create table if not exists labour_demand (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  shift_template_id uuid not null references shift_templates(id) on delete cascade,
  day_of_week int not null check (day_of_week between 0 and 6),
  min_staff int not null default 1 check (min_staff >= 0),
  max_staff int not null default 5 check (max_staff >= 0),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (company_id, shift_template_id, day_of_week)
);

alter table labour_demand enable row level security;

create policy "labour_demand_read" on labour_demand
  for select using (
    company_id in (select company_id from company_users where auth_user_id = auth.uid())
  );

create policy "labour_demand_write" on labour_demand
  for all using (
    company_id in (
      select company_id from company_users
      where auth_user_id = auth.uid() and role in ('admin', 'hr')
    )
  );
