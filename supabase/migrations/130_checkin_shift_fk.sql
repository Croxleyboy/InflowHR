-- CI-06: Add foreign key on checkin_records.shift_assignment_id
-- with ON DELETE SET NULL so deleting a shift assignment preserves
-- the check-in record with a null reference instead of orphaning it.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'checkin_records_shift_assignment_id_fkey'
      AND table_name = 'checkin_records'
  ) THEN
    ALTER TABLE checkin_records
      ADD CONSTRAINT checkin_records_shift_assignment_id_fkey
      FOREIGN KEY (shift_assignment_id) REFERENCES shift_assignments(id)
      ON DELETE SET NULL;
  END IF;
END $$;
