
const axios = require('axios');

const PAYSTACK_SECRET_KEY =
    process.env.PAYSTACK_SECRET_KEY;


// =====================================================
// INITIALIZE PAYSTACK TRANSACTION
// =====================================================

exports.initializeTransaction = async (
    email,
    amount,
    cart = [],
    deliveryOption = "standard",
    expressSurcharge = 0,
    returnUrl = "/products",
    deliveryAddress = "",
    customerName = "",
    userId = null,
    customerPhone = "",
    reservationToken = null
) => {

    const response = await axios.post(
        'https://api.paystack.co/transaction/initialize',
        {
            email,
            amount,

            metadata: {
                cart,
                deliveryOption,
                expressSurcharge,
                returnUrl,
                deliveryAddress,
                customerName,
                userId,
                customerPhone,
                reservationToken
            },

            callback_url:
                'http://192.168.0.101:8000/checkout/callback'
        },

        {
            headers: {
                Authorization:
                    `Bearer ${PAYSTACK_SECRET_KEY}`,

                'Content-Type':
                    'application/json'
            }
        }
    );

    return response.data.data;
};


// =====================================================
// VERIFY PAYSTACK TRANSACTION
// =====================================================

exports.verifyTransaction = async (
    reference
) => {

    const response = await axios.get(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,

        {
            headers: {
                Authorization:
                    `Bearer ${PAYSTACK_SECRET_KEY}`
            }
        }
    );

    return response.data.data;
};
