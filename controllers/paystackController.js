const axios = require('axios');
require('dotenv').config();
const { saveCapService } = require('../models/services');
const { getServiceDetails } = require('../models/serviceData');
const { sendPaymentConfirmationEmail } = require('../utils/mailer');
const generateEmailHTML = require('../utils/emailTemplate'); // Can be reused for both email and PDF
const generatePDF = require('../utils/pdfGenerator'); // Puppeteer-based generator

exports.verifyPayment = async (req, res) => {
  const { reference, serviceType, formData } = req.body;

  if (!reference || !serviceType || !formData) {
    return res.status(400).json({ error: 'Missing payment reference, service type, or form data.' });
  }

  try {
    const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      },
    });

    const data = response.data;

    if (data.status === true) {
      console.log('✅ Payment Verified');
      console.log('Service Type:', serviceType);

      // Save the service to DB
      await saveCapService({
        reference,
        serviceType,
        formData,
      });

      // Fetch full service data
      const serviceDetails = await getServiceDetails(reference);

      if (!serviceDetails) {
        return res.status(404).json({ error: 'Service details not found in the database.' });
      }

      // Construct full data object for email/PDF
      const serviceData = {
        reference_id: serviceDetails.reference_id,
        name: serviceDetails.name,
        email: serviceDetails.email,
        phone: serviceDetails.phone,
        service_type: serviceDetails.service_type,
        caps_count: serviceDetails.caps_count,
        cap_size: serviceDetails.cap_size,
        cleaning_type: serviceDetails.cleaning_type,
        total_cost: serviceDetails.total_cost,
        schedule_date: serviceDetails.schedule_date,
        delivery_option: serviceDetails.delivery_option,
        pickup_address: serviceDetails.pickup_address,
        pickup_time: serviceDetails.pickup_time,
        special_instructions: serviceDetails.special_instructions,
        status: serviceDetails.status,
        due_date: serviceDetails.due_date,
      };

      try {
        // Generate stylized HTML for PDF and email
        const emailHTML = generateEmailHTML(serviceData);

        // Create PDF from the email-style HTML
        const pdfFilePath = await generatePDF(emailHTML);

        // Send confirmation email with attached PDF
        await sendPaymentConfirmationEmail(serviceData, pdfFilePath);

        return res.status(200).json({
          success: true,
          message: 'Payment verified, service saved, and confirmation email sent.',
          transaction: data.data,
        });
      } catch (emailErr) {
        console.error('❌ Email or PDF generation failed:', emailErr.message);
        return res.status(500).json({ error: 'Email or PDF generation failed.' });
      }
    } else {
      return res.status(400).json({ error: 'Payment was not successful.' });
    }
  } catch (err) {
    console.error('❌ Error verifying payment:', err.message);
    return res.status(500).json({ error: 'Payment verification failed.' });
  }
};
