-- Add additional leave types for the New Leave Request screen
-- Only inserts if the type doesn't already exist (ON CONFLICT DO NOTHING)

INSERT INTO leave_types (name, default_allowance, colour)
VALUES
  ('Jury Duty', 10, '#5c6bc0'),
  ('Bereavement', 5, '#78909c'),
  ('Exam Leave', 5, '#ff9800'),
  ('Carers Leave', 5, '#ec407a'),
  ('Career Break', 0, '#7b1fa2'),
  ('Lieu Days', 0, '#00897b')
ON CONFLICT (name) DO NOTHING;
