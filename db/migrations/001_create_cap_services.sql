CREATE TABLE cap_services (
  id INT PRIMARY KEY AUTO_INCREMENT,
  reference_id VARCHAR(255) NOT NULL,
  service_type ENUM('resizing', 'laundry') NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(20),
  caps_count INT,
  cap_size VARCHAR(10),
  cleaning_type VARCHAR(50),
  total_cost INT,
  schedule_date DATE,
  delivery_option VARCHAR(50),
  pickup_address TEXT,
  pickup_time VARCHAR(50),
  special_instructions TEXT,
  status ENUM('pending', 'completed') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

