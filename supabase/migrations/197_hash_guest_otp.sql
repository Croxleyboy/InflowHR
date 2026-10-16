-- Migration 197: Hash existing plaintext OTPs in guest_users
-- Finding #3: Guest OTP stored in plaintext (CWE-256)
--
-- The otp_hash column previously stored the raw OTP value.
-- This migration hashes all existing plaintext values using SHA-256
-- via pgcrypto's digest() function. New OTPs are hashed in the
-- edge function before storage.

-- Ensure pgcrypto is available
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Hash any existing plaintext OTPs (they are 8-char alphanumeric strings)
-- SHA-256 hashes are 64 hex characters, so we only update rows
-- where the value is NOT already a 64-char hex string
UPDATE guest_users
SET otp_hash = encode(digest(otp_hash, 'sha256'), 'hex')
WHERE length(otp_hash) < 64;
