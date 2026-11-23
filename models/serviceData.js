// In models/serviceData.js
const db = require('./database'); // Assuming the database connection is set up here

// Function to fetch full service details based on reference ID
exports.getServiceDetails = async (reference) => {
  const query = `
    SELECT 
      reference_id,
         name,  
      email,
      phone,
      service_type,
      caps_count,
      cap_size,
      cleaning_type,
      total_cost,
      schedule_date,
      delivery_option,
      pickup_address,
      pickup_time,
      special_instructions,
      status,
      due_date
    FROM cap_services 
    WHERE reference_id = ?
  `;
  const values = [reference];

  try {
    const [rows] = await db.promise().query(query, values);
    if (rows.length === 0) {
      throw new Error('Service not found.');
    }
    return rows[0]; // Return all fields needed for PDF/email
  } catch (err) {
    console.error('❌ Error fetching service details:', err.message);
    throw err;
  }
};
