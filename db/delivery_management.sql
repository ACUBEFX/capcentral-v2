-- CapCentral delivery management migration.
-- Back up the Cap-Central database first. Run each ALTER only once.
USE `Cap-Central`;

ALTER TABLE orders
  ADD COLUMN delivery_address TEXT NULL,
  ADD COLUMN delivery_option VARCHAR(20) NOT NULL DEFAULT 'standard',
  ADD COLUMN tracking_number VARCHAR(100) NULL,
  ADD COLUMN dispatch_date DATETIME NULL,
  ADD COLUMN delivered_at DATETIME NULL,
  ADD COLUMN delivery_notes TEXT NULL;
