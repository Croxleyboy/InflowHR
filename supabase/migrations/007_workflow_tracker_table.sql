-- Workflow tracker table: manages submissions requiring approvals
CREATE TABLE IF NOT EXISTS public.workflow_tracker (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  emp_display_name TEXT NOT NULL,
  step INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'Pending', -- Pending / Complete
  record_type TEXT NOT NULL, -- Joiner / Leaver / Expense / Leave
  action TEXT NOT NULL,
  employee_email TEXT NOT NULL,
  assigned_to TEXT,
  onboard_id BIGINT,
  progress TEXT,
  approval_id BIGINT,
  reminder_count INTEGER DEFAULT 1,
  task_description TEXT,
  approval_status TEXT, -- ApprovedViaApp / Declined / null
  extra_info TEXT,
  record_index INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.workflow_tracker ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_workflow" ON public.workflow_tracker FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_workflow" ON public.workflow_tracker FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_workflow" ON public.workflow_tracker FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_workflow" ON public.workflow_tracker FOR DELETE TO anon USING (true);

-- Add a submitted_at column to expense_claims if not already there
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'expense_claims' AND column_name = 'submitted_at') THEN
    ALTER TABLE public.expense_claims ADD COLUMN submitted_at TIMESTAMPTZ;
  END IF;
END $$;
