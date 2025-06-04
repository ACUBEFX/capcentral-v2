const paystackService = require('../services/paystackService');

exports.renderCheckoutPage = (req, res) => {
    try {
        const { cart, total } = req.body;
        const cartParsed = typeof cart === 'string' ? JSON.parse(cart) : cart;
        res.render('checkout', { cart: cartParsed, total });
    } catch (error) {
        req.flash('error', 'Invalid cart data');
        res.redirect('/');
    }
};

exports.handlePaystackInit = async (req, res) => {
    const { email, total } = req.body;
    const amount = Number(total) * 100; // Paystack expects kobo

    try {
        const { authorization_url } = await paystackService.initializeTransaction(email, amount);
        res.redirect(authorization_url);
    } catch (error) {
        req.flash('error', 'Payment initialization failed.');
        res.redirect('back');
    }
};

exports.handlePaystackCallback = async (req, res) => {
    const { reference } = req.query;
    try {
        const paymentData = await paystackService.verifyTransaction(reference);
        if (paymentData.status === "success") {
            return res.render('success', { data: paymentData });
        } else {
            return res.render('failure', { data: paymentData });
        }
    } catch (error) {
        req.flash('error', 'Could not verify payment.');
        res.redirect('/');
    }
};