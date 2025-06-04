const axios = require('axios');
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

exports.initializeTransaction = async (email, amount) => {
    const response = await axios.post(
        'https://api.paystack.co/transaction/initialize',
        { email, amount },
        {
            headers: {
                Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                'Content-Type': 'application/json'
            }
        }
    );
    return response.data.data;
};

exports.verifyTransaction = async (reference) => {
    const response = await axios.get(
        `https://api.paystack.co/transaction/verify/${reference}`,
        { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } }
    );
    return response.data.data;
};