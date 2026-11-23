'use strict';

require('dotenv').config();
const paystackService = require('../services/paystackService');
const servicePaymentService = require('../services/servicePaymentService');
const { getServiceDetails } = require('../models/serviceData');
const { sendPaymentConfirmationEmail } = require('../utils/mailer');
const generateEmailHTML = require('../utils/emailTemplate');
const generatePDF = require('../utils/pdfGenerator');
const { sendReceiptOnce } = require('../services/receiptDelivery');

async function deliverServiceReceipt(reference) {
    const serviceDetails = await getServiceDetails(reference);
    if (!serviceDetails) throw new Error('Paid service record is unavailable for receipt recovery.');

    return sendReceiptOnce(reference, async () => {
        const emailHTML = generateEmailHTML(serviceDetails);
        const pdfFilePath = await generatePDF(emailHTML);
        await sendPaymentConfirmationEmail(serviceDetails, pdfFilePath);
    });
}

async function processVerifiedServicePayment(reference, transaction) {
    const result = await servicePaymentService.processVerifiedPayment(reference, transaction);
    if (result.status === 'success') {
        const receiptSent = await deliverServiceReceipt(reference);
        return { ...result, receiptSent };
    }
    return result;
}

async function verifyAndProcess(reference) {
    const transaction = await paystackService.verifyTransaction(reference);
    return processVerifiedServicePayment(reference, transaction);
}

function serializeAttempt(attempt) {
    return {
        reference: attempt.reference,
        authorizationUrl: attempt.authorization_url
    };
}

exports.initializeServicePayment = async (req, res) => {
    let prepared;
    try {
        prepared = await servicePaymentService.createOrGetAttempt({
            idempotencyKey: req.body?.idempotencyKey,
            serviceType: req.body?.serviceType,
            formData: req.body?.formData
        });
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    let attempt = prepared.attempt;
    if (attempt.initialization_status === 'initialized') {
        try {
            const verified = await verifyAndProcess(attempt.reference);
            if (verified.status === 'success') {
                return res.status(200).json({ success: true, paid: true, reference: attempt.reference });
            }
            if (verified.status === 'failed' || verified.status === 'abandoned') {
                return res.status(409).json({ error: 'The existing Paystack attempt did not complete.', terminal: true, reference: attempt.reference });
            }
            return res.status(200).json({ success: true, ...serializeAttempt(attempt) });
        } catch (error) {
            return res.status(202).json({
                success: false,
                pending: true,
                reference: attempt.reference,
                message: 'The existing payment is being verified. Do not start another payment.'
            });
        }
    }
    if (attempt.initialization_status === 'in_flight') {
        try {
            const verified = await verifyAndProcess(attempt.reference);
            if (verified.status === 'success') {
                return res.status(200).json({ success: true, paid: true, reference: attempt.reference });
            }
            if (verified.status === 'failed' || verified.status === 'abandoned') {
                return res.status(409).json({ error: 'The existing Paystack attempt did not complete.', terminal: true, reference: attempt.reference });
            }
        } catch (error) {
            // Unknown outcomes stay in flight; never initialize a second reference.
        }
        return res.status(202).json({
            success: false,
            pending: true,
            reference: attempt.reference,
            message: 'Payment initialization is still being reconciled. Do not start another payment.'
        });
    }
    if (attempt.initialization_status === 'paid') {
        return res.status(200).json({ success: true, paid: true, reference: attempt.reference });
    }
    if (attempt.initialization_status !== 'prepared') {
        return res.status(409).json({
            error: 'This service payment attempt cannot be initialized again.',
            terminal: true,
            reference: attempt.reference
        });
    }

    try {
        attempt = await servicePaymentService.startInitialization(
            attempt.reference,
            value => paystackService.initializeServiceTransaction(
                value.payer_email,
                value.expected_amount,
                value.reference
            )
        );
        if (attempt.initialization_status === 'in_flight') {
            return res.status(202).json({
                success: false,
                pending: true,
                reference: attempt.reference,
                message: 'Payment initialization is being reconciled. Do not start another payment.'
            });
        }
        return res.status(200).json({ success: true, ...serializeAttempt(attempt) });
    } catch (error) {
        const current = await servicePaymentService.getByReference(attempt.reference).catch(() => null);
        if (current?.initialization_status === 'rejected') {
            return res.status(400).json({ error: 'Paystack rejected this service payment initialization.' });
        }
        console.error('Service payment initialization is ambiguous:', error.code || 'initialization error');
        return res.status(502).json({
            error: 'Payment initialization could not be confirmed. Do not pay again; use the same request to check recovery.',
            reference: attempt.reference
        });
    }
};

// The client submits only the server-issued reference. Service details are
// loaded from the durable attempt and cannot be replaced after payment.
exports.verifyPayment = async (req, res) => {
    const reference = String(req.body?.reference || '').trim();
    if (!/^CCS-[A-Za-z0-9-]{20,60}$/.test(reference)) {
        return res.status(400).json({ error: 'A valid service payment reference is required.' });
    }

    try {
        if (!await servicePaymentService.getByReference(reference)) {
            return res.status(404).json({ error: 'Service payment attempt was not found.' });
        }
        const result = await verifyAndProcess(reference);
        if (result.status === 'success') {
            return res.status(200).json({ success: true, message: 'Payment verified and service request saved.' });
        }
        if (result.status === 'pending') {
            return res.status(202).json({ success: false, pending: true, message: 'Payment is still pending verification.' });
        }
        return res.status(400).json({ success: false, message: 'Paystack did not confirm a successful payment.' });
    } catch (error) {
        console.error('Service payment verification requires retry:', error.code || 'verification error');
        return res.status(502).json({ error: 'Payment verification is unavailable. Do not pay again; retry with the same reference.' });
    }
};

exports.handleServiceCallback = async (req, res) => {
    const reference = String(req.query?.reference || '').trim();
    if (!reference) return res.redirect('/services.html?payment=verification_required');
    try {
        const result = await verifyAndProcess(reference);
        const status = result.status === 'success'
            ? 'success'
            : result.status === 'pending'
                ? 'pending'
                : 'failed';
        return res.redirect(`/services.html?payment=${status}`);
    } catch (error) {
        console.error('Service payment callback requires recovery:', error.code || 'verification error');
        return res.redirect('/services.html?payment=verification_required');
    }
};

exports.processVerifiedServicePayment = processVerifiedServicePayment;
exports.deliverServiceReceipt = deliverServiceReceipt;
