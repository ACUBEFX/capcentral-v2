const axios = require('axios');
const { sendPaymentConfirmationEmail } = require('../utils/mailer');

const verifyPayment = async (req, res) => {
  const { reference } = req.body;

  try {
    const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      },
    });

    if (response.data.data.status === 'success') {
      const customerEmail = response.data.data.customer.email;
      const amount = response.data.data.amount;
      const reference = response.data.data.reference;

      await sendPaymentConfirmationEmail(customerEmail, amount, reference);

      return res.status(200).send('Payment verified and confirmation email sent');
    } else {
      return res.status(400).send('Payment verification failed');
    }
  } catch (error) {
    console.error('Verification error:', error.message);
    return res.status(500).send('Internal Server Error');
  }
};

module.exports = { verifyPayment };
