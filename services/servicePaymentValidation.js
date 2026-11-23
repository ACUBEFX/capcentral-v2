'use strict';

const LAUNDRY_PRICE_PER_CAP = Object.freeze({
    standard: 1500,
    deep: 2500,
    premium: 3500
});

function validCalendarDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function requiredText(value, label, maxLength) {
    const normalized = String(value || '').trim();
    if (!normalized || normalized.length > maxLength) {
        throw new Error(`Invalid ${label}.`);
    }
    return normalized;
}

function positiveInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new Error(`Invalid ${label}.`);
    }
    return number;
}

function normalizeServicePaymentInput(serviceType, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Service details are required.');
    }

    const name = requiredText(input.name, 'customer name', 100);
    const email = requiredText(input.email, 'customer email', 100);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid customer email.');
    const phone = requiredText(input.phone, 'phone number', 20);

    let normalized;
    let amountNaira;

    if (serviceType === 'resizing') {
        const capsCount = positiveInteger(input.capsCount, 'cap count');
        const capSize = Number(input.capSize);
        if (!Number.isFinite(capSize) || capSize <= 0 || capSize > 100) {
            throw new Error('Invalid cap size.');
        }
        if (String(capSize).length > 10) throw new Error('Invalid cap size.');
        const scheduleDate = String(input.scheduleDate || '');
        if (!validCalendarDate(scheduleDate)) throw new Error('Invalid schedule date.');
        const deliveryOption = String(input.deliveryOption || '').trim();
        if (!['self-drop', 'pickup'].includes(deliveryOption)) throw new Error('Invalid delivery option.');
        amountNaira = capsCount * 3000;
        normalized = {
            name, email, phone, capsCount, capSize: String(capSize),
            totalCost: String(amountNaira), scheduleDate, deliveryOption,
            pickupAddress: String(input.pickupAddress || '').trim().slice(0, 255),
            pickupTime: String(input.pickupTime || '').trim().slice(0, 50),
            specialInstructions: String(input.specialInstructions || '').trim().slice(0, 5000)
        };
    } else if (serviceType === 'laundry') {
        const capsCount = positiveInteger(input.laundryCapsCount, 'cap count');
        const cleaningType = String(input.cleaningType || '').trim().toLowerCase();
        const pricePerCap = LAUNDRY_PRICE_PER_CAP[cleaningType];
        if (!pricePerCap) throw new Error('Invalid cleaning type.');
        const scheduleDate = String(input.laundryScheduleDate || '');
        if (!validCalendarDate(scheduleDate)) throw new Error('Invalid schedule date.');
        const deliveryOption = String(input.laundryDeliveryOption || '').trim();
        if (!['self-drop', 'pickup'].includes(deliveryOption)) throw new Error('Invalid delivery option.');
        amountNaira = capsCount * pricePerCap;
        normalized = {
            name, email, phone, laundryCapsCount: capsCount,
            cleaningType,
            laundryTotalCost: String(amountNaira),
            laundryScheduleDate: scheduleDate,
            laundryDeliveryOption: deliveryOption,
            laundryPickupAddress: String(input.laundryPickupAddress || '').trim().slice(0, 255),
            laundryPickupTime: String(input.laundryPickupTime || '').trim().slice(0, 50),
            specialInstructions: String(input.specialInstructions || '').trim().slice(0, 5000)
        };
    } else {
        throw new Error('Unsupported service type.');
    }

    const expectedAmountInKobo = amountNaira * 100;
    if (!Number.isSafeInteger(expectedAmountInKobo) || expectedAmountInKobo <= 0 ||
        expectedAmountInKobo > 9999999999) {
        throw new Error('Invalid service payment amount.');
    }

    return { serviceType, formData: normalized, expectedAmountInKobo };
}

function validateVerifiedServicePayment(transaction, attempt) {
    const reference = String(transaction?.reference || '').trim();
    const amount = Number(transaction?.amount);
    const currency = String(transaction?.currency || '').toUpperCase();

    if (!attempt?.reference || reference !== attempt.reference) {
        throw new Error('Paystack transaction reference does not match.');
    }
    if (String(transaction?.customer?.email || '').trim().toLowerCase() !==
        String(attempt.payer_email || '').trim().toLowerCase()) {
        throw new Error('Verified Paystack customer email does not match the service request.');
    }
    if (currency !== String(attempt.currency || '').toUpperCase() ||
        !Number.isSafeInteger(amount) || amount !== Number(attempt.expected_amount)) {
        throw new Error('Verified Paystack amount or currency does not match the service.');
    }
    const metadata = transaction.metadata || {};
    if (metadata.paymentType !== 'service' ||
        metadata.servicePaymentReference !== attempt.reference) {
        throw new Error('Verified Paystack metadata does not match the service payment attempt.');
    }

    return transaction;
}

module.exports = {
    normalizeServicePaymentInput,
    validateVerifiedServicePayment,
    LAUNDRY_PRICE_PER_CAP
};
