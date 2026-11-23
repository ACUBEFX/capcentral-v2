-- Run this once in the Cap-Central database to support customer activation/deactivation.
-- It preserves all existing customer rows and makes existing accounts active by default.
ALTER TABLE signup
  ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER is_verified;
