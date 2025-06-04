const db = require('./database'); // Database connection
const moment = require('moment'); // For date handling

exports.saveCapService = async ({ reference, serviceType, formData }) => {
  let query, values;

  // Parse the scheduled date as a moment object
  let scheduleDateTime = moment(formData.scheduleDate, 'YYYY-MM-DD');

// Adjust if scheduled on a Sunday
if (scheduleDateTime.day() === 0) {
  // Move to Monday
  scheduleDateTime.add(1, 'day');
}

// Set time to 9:00 AM if none is provided
scheduleDateTime.set({ hour: 9, minute: 0, second: 0 });

// Store formatted schedule date
const scheduleDate = scheduleDateTime.format('YYYY-MM-DD HH:mm:ss');

// Now calculate dueDate from this schedule
let dueBase = scheduleDateTime.clone();

if (serviceType === 'resizing') {
  dueBase = addBusinessDays(dueBase, 5);
} else if (serviceType === 'laundry') {
  dueBase = addBusinessDays(dueBase, 3);
} else {
  throw new Error('Unknown service type');
}

// Set due date to 6:00 PM
const dueDate = dueBase.set({ hour: 18, minute: 0, second: 0 }).format('YYYY-MM-DD HH:mm:ss');

// Null by default (will be set when item is received)
const receivedDate = null;

function addBusinessDays(startMoment, daysToAdd) {
  let daysAdded = 0;
  while (daysAdded < daysToAdd) {
    startMoment.add(1, 'day');
    if (startMoment.day() !== 0) { // Skip Sundays
      daysAdded++;
    }
  }
  return startMoment;
}



  // Insert logic for resizing service
if (serviceType === 'resizing') {
  query = `
    INSERT INTO cap_services (
      reference_id, name, service_type, email, phone, caps_count, total_cost, schedule_date, 
      due_date, delivery_option, pickup_address, pickup_time, cap_size, special_instructions, 
      status, received_status, received_date
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  values = [
    reference,                             // reference_id
    formData.name,                         // name
    'resizing',                            // service_type
    formData.email,                        // email
    formData.phone,                        // phone
    parseInt(formData.capsCount),          // caps_count
    parseInt(formData.totalCost.replace(/[^\d]/g, '')), // total_cost (cleaned)
    formData.scheduleDate,                 // schedule_date
    dueDate,                               // due_date
    formData.deliveryOption,               // delivery_option
    formData.pickupAddress || '',          // pickup_address
    formData.pickupTime || '',             // pickup_time
    formData.capSize,                      // cap_size
    formData.specialInstructions || '',    // special_instructions
    'pending',                             // status
    0,                                      // received_status
    receivedDate                            // received_date (null or date)
  ];
}


  // Insert logic for laundry service
  else if (serviceType === 'laundry') {
    query = `
      INSERT INTO cap_services (
        reference_id, name, service_type, email, phone, caps_count, cleaning_type, total_cost, schedule_date, 
        due_date, delivery_option, pickup_address, pickup_time, special_instructions, status, received_status, received_date
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    values = [
      reference,                           // reference_id
      formData.name,                        // name
      'laundry',                            // service_type
      formData.email,                       // email
      formData.phone,                       // phone
      parseInt(formData.laundryCapsCount),  // caps_count (ensure it is an integer)
      formData.cleaningType,                // cleaning_type
      parseInt(formData.laundryTotalCost.replace(/[^\d]/g, '')), // total_cost (cleaned value)
      formData.laundryScheduleDate,         // schedule_date
      dueDate,                              // due_date
      formData.laundryDeliveryOption,       // delivery_option
      formData.laundryPickupAddress || '',  // pickup_address (empty string if missing)
      formData.laundryPickupTime || '',     // pickup_time (empty string if missing)
      formData.specialInstructions || '',   // special_instructions (empty if missing)
      'pending',                            // status (initial status)
      0,                                    // received_status (0 initially, not received)
      receivedDate                          // received_date (null initially)
    ];
  } 

  else {
    throw new Error('Unknown service type');
  }

  try {
    // Debugging step: log query and values to verify the issue
    console.log('Executing query:', query);
    console.log('With values:', values);

    // Execute the query and save the service data
    const [result] = await db.promise().execute(query, values);

    // Assuming the `id` is auto-generated and returned in the result object
    const serviceId = result.insertId; // Or any equivalent in your query result
    console.log('✅ Service data saved successfully');

    // Return the service ID so it can be used in other operations
    return { id: serviceId };  // Return the saved service data with the id
  } catch (err) {
    // Log error for debugging
    console.error('❌ Error saving service data:', err.message);
    throw err;
  }
};
