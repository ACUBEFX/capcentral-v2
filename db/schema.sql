CREATE TABLE cap_services (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference_id VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  service_type ENUM('resizing', 'laundry') NOT NULL,
  email VARCHAR(100) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  caps_count INT UNSIGNED NOT NULL,
  cap_size VARCHAR(10),              -- Nullable, since not all services might need it
  cleaning_type VARCHAR(50),         -- Nullable, only for laundry
  total_cost DECIMAL(10, 2) NOT NULL,
  schedule_date DATE NOT NULL,
  due_date DATETIME,                 -- Nullable, calculated based on schedule/received_date
  delivery_option ENUM('self-drop', 'pickup') NOT NULL,
  pickup_address VARCHAR(255),      -- Nullable, depends on delivery option
  pickup_time VARCHAR(50),           -- Nullable, depends on delivery option/time scheduling
  special_instructions TEXT,         -- Nullable, longer text field for notes
  status ENUM('pending', 'completed', 'collected') NOT NULL DEFAULT 'pending',
  received_status TINYINT(1) NOT NULL DEFAULT 0,  -- 0 = not received, 1 = received
  received_date DATETIME,            -- Nullable, date item was received
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- The user table 


CREATE TABLE signup (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  is_verified BOOLEAN DEFAULT FALSE,
  phone_number VARCHAR(20),
  address TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
