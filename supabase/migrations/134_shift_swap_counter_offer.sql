-- Add columns for two-step swap negotiation:
-- target picks a counter-shift, requester approves/declines
ALTER TABLE shift_swap_requests
  ADD COLUMN IF NOT EXISTS target_shift_assignment_id UUID REFERENCES shift_assignments(id),
  ADD COLUMN IF NOT EXISTS response_message TEXT;

-- New statuses: pending → counter_offered → approved/rejected/cancelled
-- (existing pending/approved/rejected still valid)
