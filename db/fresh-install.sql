-- CapCentral fresh-install schema for MySQL 8.0+
-- Run once against the already-created, empty database selected by the client.
-- This file deliberately contains no USE statement, data imports, or customer data.
-- It is a complete DDL baseline through additive migrations 001-009; do not
-- apply those migrations again after installing this schema.

CREATE TABLE `signup` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(255) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `password` VARCHAR(255) NOT NULL,
  `is_verified` TINYINT(1) DEFAULT 0,
  `phone_number` VARCHAR(20) DEFAULT NULL,
  `address` TEXT,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_admin` TINYINT(1) NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_signup_username` (`username`),
  UNIQUE KEY `uq_signup_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `categories` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  `slug` VARCHAR(100) NOT NULL,
  `template` VARCHAR(50) NOT NULL DEFAULT 'standard',
  `is_visible` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_categories_name` (`name`),
  UNIQUE KEY `uq_categories_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `products` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_code` VARCHAR(100) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT,
  `price` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `stock_quantity` INT UNSIGNED NOT NULL DEFAULT 5,
  `image_url` VARCHAR(500) DEFAULT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `category` VARCHAR(100) NOT NULL DEFAULT 'Shoes',
  `cap_type` VARCHAR(60) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_products_product_code` (`product_code`),
  KEY `idx_products_category` (`category`),
  KEY `idx_products_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `product_variants` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_id` INT UNSIGNED NOT NULL,
  `size` VARCHAR(100) NOT NULL,
  `price` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `stock_quantity` INT UNSIGNED NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_product_variants_product_size` (`product_id`, `size`),
  CONSTRAINT `fk_product_variants_product`
    FOREIGN KEY (`product_id`) REFERENCES `products` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `cap_services` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `reference_id` VARCHAR(50) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `service_type` ENUM('resizing','laundry') NOT NULL,
  `email` VARCHAR(100) NOT NULL,
  `phone` VARCHAR(20) NOT NULL,
  `caps_count` INT UNSIGNED NOT NULL,
  `cap_size` VARCHAR(10) DEFAULT NULL,
  `cleaning_type` VARCHAR(50) DEFAULT NULL,
  `total_cost` DECIMAL(10,2) NOT NULL,
  `schedule_date` DATE NOT NULL,
  `due_date` DATETIME DEFAULT NULL,
  `delivery_option` ENUM('self-drop','pickup') NOT NULL,
  `pickup_address` VARCHAR(255) DEFAULT NULL,
  `pickup_time` VARCHAR(50) DEFAULT NULL,
  `special_instructions` TEXT,
  `status` ENUM('pending','completed','collected') NOT NULL DEFAULT 'pending',
  `received_status` TINYINT(1) NOT NULL DEFAULT 0,
  `received_date` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cap_services_reference_id` (`reference_id`),
  KEY `idx_cap_services_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `service_payment_attempts` (
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

CREATE TABLE `orders` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_reference` VARCHAR(100) NOT NULL,
  `user_id` INT DEFAULT NULL,
  `customer_name` VARCHAR(255) NOT NULL,
  `customer_email` VARCHAR(255) NOT NULL,
  `customer_phone` VARCHAR(20) DEFAULT NULL,
  `subtotal` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `delivery_fee` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `express_surcharge` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `total_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `currency` VARCHAR(10) NOT NULL DEFAULT 'NGN',
  `order_status` ENUM('pending','paid','processing','shipped','delivered','cancelled','refunded') NOT NULL DEFAULT 'pending',
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `delivery_address` TEXT,
  `delivery_type` VARCHAR(30) DEFAULT NULL,
  `tracking_number` VARCHAR(100) DEFAULT NULL,
  `dispatch_date` DATETIME DEFAULT NULL,
  `delivered_date` DATETIME DEFAULT NULL,
  `delivery_notes` TEXT,
  `delivery_option` VARCHAR(30) DEFAULT NULL,
  `delivered_at` DATETIME DEFAULT NULL,
  `promo_code_id` INT UNSIGNED DEFAULT NULL,
  `promo_code` VARCHAR(50) DEFAULT NULL,
  `discount_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_orders_order_reference` (`order_reference`),
  KEY `idx_orders_user_id` (`user_id`),
  KEY `idx_orders_promo_code_id` (`promo_code_id`),
  KEY `idx_orders_created_at` (`created_at`),
  CONSTRAINT `fk_orders_user`
    FOREIGN KEY (`user_id`) REFERENCES `signup` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `order_items` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id` INT UNSIGNED NOT NULL,
  `product_id` VARCHAR(100) DEFAULT NULL,
  `variant_id` INT UNSIGNED DEFAULT NULL,
  `product_name` VARCHAR(255) NOT NULL,
  `product_size` VARCHAR(100) DEFAULT NULL,
  `quantity` INT UNSIGNED NOT NULL DEFAULT 1,
  `unit_price` DECIMAL(10,2) NOT NULL,
  `total_price` DECIMAL(10,2) NOT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_order_items_order_id` (`order_id`),
  KEY `idx_order_items_variant_id` (`variant_id`),
  CONSTRAINT `fk_order_items_order`
    FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_order_items_variant`
    FOREIGN KEY (`variant_id`) REFERENCES `product_variants` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `payments` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id` INT UNSIGNED NOT NULL,
  `paystack_reference` VARCHAR(255) NOT NULL,
  `paystack_transaction_id` VARCHAR(100) DEFAULT NULL,
  `amount` DECIMAL(10,2) NOT NULL,
  `currency` VARCHAR(10) NOT NULL DEFAULT 'NGN',
  `payment_status` ENUM('pending','success','failed','abandoned','refunded') NOT NULL DEFAULT 'pending',
  `payment_channel` VARCHAR(100) DEFAULT NULL,
  `paid_at` DATETIME DEFAULT NULL,
  `gateway_response` TEXT,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_payments_paystack_reference` (`paystack_reference`),
  KEY `idx_payments_order_id` (`order_id`),
  KEY `idx_payments_status` (`payment_status`),
  CONSTRAINT `fk_payments_order`
    FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `inventory_reservations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `reservation_token` VARCHAR(100) NOT NULL,
  `paystack_reference` VARCHAR(255) DEFAULT NULL,
  `product_id` INT UNSIGNED NOT NULL,
  `variant_id` INT UNSIGNED DEFAULT NULL,
  `quantity` INT UNSIGNED NOT NULL,
  `status` ENUM('reserved','paid','released','expired') NOT NULL DEFAULT 'reserved',
  `expires_at` DATETIME NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_reservation_product_variant`
    (`reservation_token`, `product_id`, (COALESCE(`variant_id`, 0))),
  KEY `idx_reservation_reference` (`paystack_reference`),
  KEY `idx_reservation_expiry` (`status`, `expires_at`),
  KEY `idx_reservation_product` (`product_id`),
  KEY `idx_reservation_variant` (`variant_id`),
  CONSTRAINT `fk_reservation_product`
    FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_reservation_variant`
    FOREIGN KEY (`variant_id`) REFERENCES `product_variants` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `promo_codes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) NOT NULL,
  `discount_type` ENUM('percentage','fixed') NOT NULL,
  `discount_value` DECIMAL(10,2) NOT NULL,
  `min_order_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `max_discount` DECIMAL(10,2) DEFAULT NULL,
  `starts_at` DATETIME DEFAULT NULL,
  `expires_at` DATETIME DEFAULT NULL,
  `usage_limit` INT UNSIGNED DEFAULT NULL,
  `usage_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_promo_code` (`code`),
  KEY `idx_promo_active_window` (`is_active`, `starts_at`, `expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `promo_usage_reservations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `promo_code_id` INT UNSIGNED NOT NULL,
  `reservation_token` VARCHAR(100) NOT NULL,
  `paystack_reference` VARCHAR(255) DEFAULT NULL,
  `status` ENUM('reserved','redeemed','released') NOT NULL DEFAULT 'reserved',
  `expires_at` DATETIME NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_promo_usage_token` (`reservation_token`),
  UNIQUE KEY `uq_promo_usage_reference` (`paystack_reference`),
  KEY `idx_promo_usage_capacity` (`promo_code_id`, `status`),
  KEY `idx_promo_usage_expiry` (`status`, `expires_at`),
  CONSTRAINT `fk_promo_usage_code`
    FOREIGN KEY (`promo_code_id`) REFERENCES `promo_codes` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `promo_redemptions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `promo_code_id` INT UNSIGNED NOT NULL,
  `order_id` INT UNSIGNED NOT NULL,
  `paystack_reference` VARCHAR(255) NOT NULL,
  `discount_amount` DECIMAL(10,2) NOT NULL,
  `redeemed_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_promo_redemption_order` (`order_id`),
  UNIQUE KEY `uq_promo_redemption_reference` (`paystack_reference`),
  KEY `idx_promo_redemptions_code` (`promo_code_id`),
  CONSTRAINT `fk_promo_redemption_code`
    FOREIGN KEY (`promo_code_id`) REFERENCES `promo_codes` (`id`),
  CONSTRAINT `fk_promo_redemption_order`
    FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `payment_initialization_attempts` (
  `reservation_token` VARCHAR(100) NOT NULL,
  `paystack_reference` VARCHAR(255) NOT NULL,
  `initialization_status` ENUM('prepared','in_flight','initialized','rejected') NOT NULL DEFAULT 'prepared',
  `expected_amount` BIGINT UNSIGNED NOT NULL,
  `currency` CHAR(3) NOT NULL DEFAULT 'NGN',
  `rejection_detail` VARCHAR(1000) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`reservation_token`),
  UNIQUE KEY `uq_payment_attempt_reference` (`paystack_reference`),
  KEY `idx_payment_attempt_recovery` (`initialization_status`, `updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `processed_cap_payments` (
  `reference` VARCHAR(100) NOT NULL,
  `processed_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`reference`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `capcentral_receipt_emails` (
  `reference` VARCHAR(100) NOT NULL,
  `status` ENUM('sending','sent','failed') NOT NULL DEFAULT 'sending',
  `lease_token` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`reference`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `deliveries` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id` INT UNSIGNED NOT NULL,
  `delivery_option` ENUM('standard','express') NOT NULL DEFAULT 'standard',
  `delivery_address` TEXT NOT NULL,
  `delivery_status` ENUM('pending','processing','shipped','out_for_delivery','delivered','cancelled') NOT NULL DEFAULT 'pending',
  `scheduled_date` DATE DEFAULT NULL,
  `delivered_at` DATETIME DEFAULT NULL,
  `delivery_notes` TEXT,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_deliveries_order_id` (`order_id`),
  CONSTRAINT `fk_deliveries_order`
    FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `order_requests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id` INT UNSIGNED NOT NULL,
  `user_id` INT NOT NULL,
  `request_type` ENUM('cancellation','refund') NOT NULL,
  `reason` TEXT NOT NULL,
  `request_status` ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `admin_note` TEXT,
  `reviewed_by` INT DEFAULT NULL,
  `reviewed_at` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_order_requests_user` (`user_id`),
  KEY `idx_order_requests_order` (`order_id`),
  KEY `idx_order_requests_status` (`request_status`),
  CONSTRAINT `fk_order_requests_order`
    FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_order_requests_user`
    FOREIGN KEY (`user_id`) REFERENCES `signup` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `stock_movements` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_code` VARCHAR(100) NOT NULL,
  `variant_id` INT UNSIGNED DEFAULT NULL,
  `variant_size` VARCHAR(100) DEFAULT NULL,
  `change_quantity` INT NOT NULL,
  `previous_quantity` INT UNSIGNED NOT NULL,
  `new_quantity` INT UNSIGNED NOT NULL,
  `reason` VARCHAR(255) NOT NULL,
  `order_reference` VARCHAR(100) DEFAULT NULL,
  `admin_user_id` INT DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_stock_product` (`product_code`),
  KEY `idx_stock_created` (`created_at`),
  KEY `idx_stock_variant` (`variant_id`),
  CONSTRAINT `fk_stock_variant`
    FOREIGN KEY (`variant_id`) REFERENCES `product_variants` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `admin_audit_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_user_id` INT DEFAULT NULL,
  `action` VARCHAR(100) NOT NULL,
  `entity_type` VARCHAR(100) NOT NULL,
  `entity_id` VARCHAR(100) DEFAULT NULL,
  `details` JSON DEFAULT NULL,
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audit_admin` (`admin_user_id`),
  KEY `idx_audit_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
