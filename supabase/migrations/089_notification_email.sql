-- Add send_email flag and email_sent tracking to notifications
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS send_email boolean DEFAULT false;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS email_sent boolean DEFAULT false;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS email_sent_at timestamptz;
