-- Allow employees to create their own goals (manager_id was NOT NULL, make nullable for self-created)
alter table performance_goals alter column manager_id drop not null;

-- Goal comments / updates
create table if not exists performance_goal_comments (
  id uuid default gen_random_uuid() primary key,
  goal_id uuid not null references performance_goals(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  author_id uuid not null references employees(id) on delete cascade,
  body text not null,
  created_at timestamptz default now()
);

create index if not exists idx_goal_comments_goal on performance_goal_comments(goal_id);
create index if not exists idx_goal_comments_company on performance_goal_comments(company_id);

alter table performance_goal_comments enable row level security;

create policy "goal_comments_read" on performance_goal_comments for select using (
  company_id in (select company_id from company_users where auth_user_id = auth.uid() and is_active = true)
);

create policy "goal_comments_insert" on performance_goal_comments for insert with check (
  company_id in (select company_id from company_users where auth_user_id = auth.uid() and is_active = true)
);

create policy "goal_comments_update" on performance_goal_comments for update using (
  company_id in (select company_id from company_users where auth_user_id = auth.uid() and is_active = true)
);

create policy "goal_comments_delete" on performance_goal_comments for delete using (
  company_id in (select company_id from company_users where auth_user_id = auth.uid() and is_active = true)
);
