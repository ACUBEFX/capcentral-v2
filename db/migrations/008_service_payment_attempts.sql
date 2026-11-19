-- Add durable, idempotent service payment initialization records.
-- Additive only: existing service and payment history is preserved.
CREATE TABLE IF NOT EXISTS `service_payment_attempts` (
  `reference` VARCHAR(100) NOT NULL,
  `idempotency_key` VARCHAR(100) NOT NULL,
  `service_type` ENUM('resizing','laundry') NOT NULL,
  `payer_email` VARCHAR(255) NOT NULL,
  `expected_amount` BIGINT UNSIGNED NOT NULL,
  `currency` CHAR(3) NOT NULL DEFAULT 'NGN',
  `service_details` JSON NOT NULL,
  `initialization_status` ENUM('prepared','in_flight','initialized','rejected','paid','failed') NOT NULL DEFAULT 'prepared',
  `authorization_url` VARCHAR(1000) DEFAULT NULL,
  `paystack_transaction_id` VARCHAR(100) DEFAULT NULL,
  `rejection_detail` VARCHAR(1000) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`reference`),
  UNIQUE KEY `uq_service_payment_idempotency` (`idempotency_key`),
  KEY `idx_service_payment_recovery` (`initialization_status`, `updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
