
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
    reservationToken = null,
    promoCode = null,
    promoId = null,
    promoDiscountInKobo = 0,
    reference = null
) => {

    const response = await axios.post(
        'https://api.paystack.co/transaction/initialize',
        {
            email,
            amount,
            reference,

            metadata: {
                cart,
                deliveryOption,
                expressSurcharge,
                returnUrl,
                deliveryAddress,
                customerName,
                userId,
                customerPhone,
                promoId,
                promoDiscountInKobo,
                reservationToken,
                promoCode
            },

            callback_url:
                process.env.PAYSTACK_CALLBACK_URL
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

exports.initializeServiceTransaction = async (email, amount, reference) => {
    const response = await axios.post(
        'https://api.paystack.co/transaction/initialize',
        {
            email,
            amount,
            reference,
            currency: 'NGN',
            metadata: {
                paymentType: 'service',
                servicePaymentReference: reference
            },
            callback_url: process.env.PAYSTACK_CALLBACK_URL
        },
        {
            headers: {
                Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                'Content-Type': 'application/json'
            }
        }
    );

    if (response.data?.status !== true || !response.data?.data) {
        const error = new Error('Paystack rejected service payment initialization.');
        error.response = { status: response.status, data: response.data };
        error.definitiveInitializationRejection = true;
        throw error;
    }
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
