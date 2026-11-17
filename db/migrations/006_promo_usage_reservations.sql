USE `Cap-Central`;

CREATE TABLE IF NOT EXISTS promo_usage_reservations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    promo_code_id INT UNSIGNED NOT NULL,
    reservation_token VARCHAR(100) NOT NULL,
    paystack_reference VARCHAR(255) DEFAULT NULL,
    status ENUM('reserved', 'redeemed', 'released')
        NOT NULL DEFAULT 'reserved',
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_promo_usage_token (reservation_token),
    UNIQUE KEY uq_promo_usage_reference (paystack_reference),
    KEY idx_promo_usage_capacity (promo_code_id, status),
    CONSTRAINT fk_promo_usage_code
        FOREIGN KEY (promo_code_id)
        REFERENCES promo_codes(id)
        ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
