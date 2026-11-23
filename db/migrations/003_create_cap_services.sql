CREATE TABLE IF NOT EXISTS cap_services (
    id INT AUTO_INCREMENT PRIMARY KEY,
    reference_id VARCHAR(255) NOT NULL UNIQUE,  -- Unique reference ID
    service_type ENUM('resizing', 'laundry') NOT NULL,  -- Service type (resizing or laundry)
    name VARCHAR(255) NOT NULL,  -- User name (new field)
    email VARCHAR(255) NOT NULL,  -- User email
    phone VARCHAR(20) NOT NULL,  -- User phone number
    caps_count INT NOT NULL,  -- Number of caps for resizing
    cap_size VARCHAR(20),  -- Size of the cap (for resizing)
    cleaning_type VARCHAR(255),  -- Type of cleaning (for laundry)
    total_cost INT NOT NULL,  -- Total cost of the service
    schedule_date DATETIME NOT NULL,  -- Scheduled date for service
    delivery_option VARCHAR(255),  -- Delivery option
    pickup_address TEXT,  -- Pickup address
    pickup_time DATETIME,  -- Pickup time
    special_instructions TEXT,  -- Any special instructions for the service
    status ENUM('pending', 'completed', 'collected') DEFAULT 'pending',  -- Status of the service
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,  -- Timestamp when service is created
    received_status TINYINT DEFAULT 0,  -- 0 = Not received, 1 = Received
    received_date DATETIME DEFAULT NULL,  -- Date when the item was received (if applicable)
    due_date DATETIME DEFAULT NULL  -- Due date calculated from received date
);

CREATE INDEX idx_reference_id ON cap_services(reference_id);
