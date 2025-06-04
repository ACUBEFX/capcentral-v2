const moment = require('moment');
module.exports = function generateEmailHTML(serviceData) {
  return `
  <!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>CapCentral Payment Receipt</title>
<style>
  body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    margin: 0;
    padding: 0;
    background: #fff;
    color: #333;
  }
  .container {
    width: 700px;
    margin: auto;
    padding: 40px;
    border: 1px solid #ddd;
    border-radius: 8px;
  }
  .header {
    text-align: center;
    margin-bottom: 30px;
  }
  .header h1 {
    color: #007bff;
    margin-bottom: 5px;
  }
  .section {
    margin-bottom: 25px;
  }
  .section h2 {
    font-size: 18px;
    color: #444;
    border-bottom: 1px solid #eee;
    padding-bottom: 5px;
    margin-bottom: 15px;
  }
  .info p {
    margin: 5px 0;
    font-size: 15px;
  }
  .highlight {
    font-weight: bold;
    color: #28a745;
  }
  .footer {
    margin-top: 40px;
    text-align: center;
    font-size: 12px;
    color: #888;
  }
  .logo {
    width: 120px;
    margin-bottom: 10px;
  }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>Payment Receipt</h1>
    <p>Thank you for using CapCentral</p>
  </div>

  <div class="section">
    <h2>Reference Info</h2>
    <div class="info">
      <p><strong>Reference ID:</strong> ${serviceData.reference_id}</p>
    </div>
  </div>

  <div class="section">
    <h2>Customer Details</h2>
    <div class="info">
      <p><strong>Name:</strong> ${serviceData.name}</p>
      <p><strong>Email:</strong> ${serviceData.email}</p>
      <p><strong>Phone:</strong> ${serviceData.phone}</p>
    </div>
  </div>

  <div class="section">
    <h2>Service Details</h2>
    <div class="info">
      <p><strong>Service Type:</strong> ${serviceData.service_type}</p>
      <p><strong>Caps Count:</strong> ${serviceData.caps_count}</p>

      ${serviceData.service_type === 'resizing' ? `
        <p><strong>Cap Size:</strong> ${serviceData.cap_size}</p>
      ` : `
        <p><strong>Cleaning Type:</strong> ${serviceData.cleaning_type}</p>
      `}
    </div>
  </div>

  <div class="section">
    <h2>Delivery & Schedule</h2>
    <div class="info">
      <p><strong>Delivery Option:</strong> ${serviceData.delivery_option}</p>
      ${serviceData.pickup_address ? `<p><strong>Pickup Address:</strong> ${serviceData.pickup_address}</p>` : ''}
      ${serviceData.pickup_time ? `<p><strong>Pickup Time:</strong> ${serviceData.pickup_time}</p>` : ''}
      <p><strong>Scheduled Service Date:</strong> ${moment(serviceData.schedule_date).format('MMM DD, YYYY')}</p>
    </div>
  </div>

  <div class="section">
    <h2>Payment</h2>
    <div class="info">
      <p><strong>Total Cost:</strong> ₦${serviceData.total_cost.toLocaleString('en-NG', { style: 'currency', currency: 'NGN' })}</p>
    </div>
  </div>

  <div class="section">
    <h2>Status & Due Date</h2>
    <div class="info">
      <p><strong>Status:</strong> <span class="highlight">${serviceData.status}</span></p>
      ${serviceData.status === 'received' ? `
        <p><strong>Due Date:</strong> ${moment(serviceData.due_date).format('MMM DD, YYYY')}</p>
      ` : `
        <p><strong>Due Date:</strong> The due date will be provided once the item is received.</p>
      `}
    </div>
  </div>

  ${serviceData.special_instructions ? `
    <div class="section">
      <h2>Special Instructions</h2>
      <div class="info">
        <p>${serviceData.special_instructions}</p>
      </div>
    </div>` : ''}

  <div class="footer">
    <p>capcentraldesk@gmail.com | CapCentral &copy; ${new Date().getFullYear()}</p>
  </div>
</div>
</body>
</html>
  `;
};
