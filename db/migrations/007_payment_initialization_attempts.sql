USE `Cap-Central`;

CREATE TABLE IF NOT EXISTS payment_initialization_attempts (
    reservation_token VARCHAR(100) NOT NULL,
    paystack_reference VARCHAR(255) NOT NULL,
    initialization_status ENUM('prepared', 'in_flight', 'initialized', 'rejected')
        NOT NULL DEFAULT 'prepared',
    expected_amount BIGINT UNSIGNED NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'NGN',
    rejection_detail VARCHAR(1000) DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (reservation_token),
    UNIQUE KEY uq_payment_attempt_reference (paystack_reference),
    KEY idx_payment_attempt_recovery (initialization_status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- No foreign key is used because a reservation token maps to multiple
-- inventory rows and may have no promo_usage_reservations row at all.
