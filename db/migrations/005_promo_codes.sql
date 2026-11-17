USE `Cap-Central`;

CREATE TABLE IF NOT EXISTS promo_codes (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    code VARCHAR(50) NOT NULL,
    discount_type ENUM('percentage', 'fixed') NOT NULL,
    discount_value DECIMAL(10,2) NOT NULL,
    min_order_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    max_discount DECIMAL(10,2) DEFAULT NULL,
    starts_at DATETIME DEFAULT NULL,
    expires_at DATETIME DEFAULT NULL,
    usage_limit INT UNSIGNED DEFAULT NULL,
    usage_count INT UNSIGNED NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_promo_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE orders
    ADD COLUMN promo_code_id INT UNSIGNED DEFAULT NULL,
    ADD COLUMN promo_code VARCHAR(50) DEFAULT NULL,
    ADD COLUMN discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    ADD KEY idx_orders_promo_code_id (promo_code_id);

CREATE TABLE IF NOT EXISTS promo_redemptions (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    promo_code_id INT UNSIGNED NOT NULL,
    order_id INT UNSIGNED NOT NULL,
    paystack_reference VARCHAR(255) NOT NULL,
    discount_amount DECIMAL(10,2) NOT NULL,
    redeemed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_promo_redemption_order (order_id),
    UNIQUE KEY uq_promo_redemption_reference (paystack_reference),
    KEY idx_promo_redemptions_code (promo_code_id),
    CONSTRAINT fk_promo_redemption_code
        FOREIGN KEY (promo_code_id) REFERENCES promo_codes(id),
    CONSTRAINT fk_promo_redemption_order
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
