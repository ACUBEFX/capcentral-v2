
const db = require('./models/database');

const sql = `
CREATE TABLE IF NOT EXISTS order_requests (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id INT UNSIGNED NOT NULL,
    user_id INT NOT NULL,
    request_type ENUM('cancellation', 'refund') NOT NULL,
    reason TEXT NOT NULL,
    request_status ENUM('pending', 'approved', 'rejected')
        NOT NULL DEFAULT 'pending',
    admin_note TEXT NULL,
    reviewed_by INT NULL,
    reviewed_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_order_requests_user (user_id),
    INDEX idx_order_requests_order (order_id),
    INDEX idx_order_requests_status (request_status),

    CONSTRAINT fk_order_requests_order
        FOREIGN KEY (order_id) REFERENCES orders(id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_order_requests_user
        FOREIGN KEY (user_id) REFERENCES signup(id)
        ON DELETE RESTRICT
) ENGINE=InnoDB;
`;

db.query(sql, (error) => {
    if (error) {
        console.error('Table creation failed:', error.message);
    } else {
        console.log('order_requests table created successfully!');
    }

    db.end();
});
