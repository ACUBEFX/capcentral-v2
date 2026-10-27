USE `Cap-Central`;

-- One row per verified Paystack reference prevents callback/webhook double deductions.
CREATE TABLE IF NOT EXISTS processed_cap_payments (
    reference VARCHAR(100) NOT NULL PRIMARY KEY,
    processed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
