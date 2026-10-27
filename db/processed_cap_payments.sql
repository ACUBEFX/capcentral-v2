USE `Cap-Central`;

-- One row per verified Paystack reference. This prevents a callback and webhook
-- (or a repeated webhook) from selling/decrementing the same cap more than once.
CREATE TABLE IF NOT EXISTS processed_cap_payments (
    reference VARCHAR(100) NOT NULL,
    processed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (reference)
) ENGINE=InnoDB;
