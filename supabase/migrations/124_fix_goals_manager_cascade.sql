-- PF-02: Change performance_goals.manager_id from ON DELETE CASCADE to ON DELETE SET NULL.
-- Prevents silent deletion of all employee goals when a manager is removed.

ALTER TABLE performance_goals ALTER COLUMN manager_id DROP NOT NULL;

ALTER TABLE performance_goals DROP CONSTRAINT IF EXISTS performance_goals_manager_id_fkey;

ALTER TABLE performance_goals
  ADD CONSTRAINT performance_goals_manager_id_fkey
  FOREIGN KEY (manager_id) REFERENCES employees(id) ON DELETE SET NULL;
