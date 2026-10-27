
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const fs = require('fs');

// =====================================================
// NODEMAILER CONFIGURATION
// =====================================================

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

// =====================================================
// HELPER FUNCTIONS
// =====================================================

// Safely display user/product data in HTML emails.
const escapeEmailHtml = (value = '') =>
    String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    })[char]);

// Handles deliveryOption as a string or an array.
const normalizeDeliveryOption = (deliveryOption) => {
    const value = Array.isArray(deliveryOption)
        ? deliveryOption[0]
        : deliveryOption;

    return String(value || 'standard').trim().toLowerCase();
};

const formatNaira = (amount) =>
    `₦${(Number(amount) || 0).toLocaleString('en-NG')}`;

const formatDate = (date) =>
    date.toLocaleDateString('en-NG', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });

// =====================================================
// PRODUCT / BASKET PAYMENT CONFIRMATION EMAIL
// =====================================================

const sendProductPaymentConfirmationEmail = async (
    customerInfo,
    products,
    totalAmount,
    deliveryOption = 'standard',
    expressSurcharge = 0,
    paymentReference = null
) => {
    if (!customerInfo?.email) {
        throw new Error(
            'Cannot send payment confirmation: customer email is missing.'
        );
    }

    if (!Array.isArray(products) || products.length === 0) {
        throw new Error(
            'Cannot send payment confirmation: purchased items are missing.'
        );
    }

    const normalizedDeliveryOption =
        normalizeDeliveryOption(deliveryOption);

    const isExpress = normalizedDeliveryOption === 'express';

    const orderReference = paymentReference ||
        `CAP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const customerName = escapeEmailHtml(
        customerInfo.name || 'Valued customer'
    );

    const safeReference = escapeEmailHtml(orderReference);

    // -----------------------------------
    // ESTIMATED DELIVERY
    // -----------------------------------

    const today = new Date();

    const deliveryMinDays = isExpress ? 1 : 2;
    const deliveryMaxDays = isExpress ? 2 : 3;

    const minDeliveryDate = new Date(today);
    minDeliveryDate.setDate(today.getDate() + deliveryMinDays);

    const maxDeliveryDate = new Date(today);
    maxDeliveryDate.setDate(today.getDate() + deliveryMaxDays);

    const deliveryDateText =
        `${formatDate(minDeliveryDate)} - ${formatDate(maxDeliveryDate)}`;

    const deliveryName = isExpress
        ? 'Express Delivery'
        : 'Standard Delivery';

    const deliveryMessage = isExpress
        ? 'Your order has been prioritized for faster delivery.'
        : 'Your order is expected to arrive within 2–3 business days.';

    // -----------------------------------
    // PRODUCT TOTALS
    // -----------------------------------

    const productSubtotal = products.reduce((total, product) => {
        const price = Number(product.price) || 0;
        const quantity = Math.max(1, Number(product.quantity) || 1);

        return total + price * quantity;
    }, 0);

    const subtotal = productSubtotal;
    const surcharge = Number(expressSurcharge) || 0;

    const totalPaid =
        totalAmount !== undefined &&
        totalAmount !== null &&
        totalAmount !== ''
            ? Number(totalAmount)
            : subtotal + surcharge;

    // -----------------------------------
    // PRODUCT TABLE
    // -----------------------------------

    const productRows = products.map(product => {
        const productName = escapeEmailHtml(
            product.name || product.title || 'Product'
        );

        const productSize = product.size
            ? escapeEmailHtml(product.size)
            : '';

        const price = Number(product.price) || 0;
        const quantity = Math.max(1, Number(product.quantity) || 1);
        const itemTotal = price * quantity;

        return `
            <tr>
                <td style="padding:14px 8px;border-bottom:1px solid #eee;color:#333;font-size:14px;">
                    <strong>${productName}</strong>
                    ${
                        productSize
                            ? `<br><span style="color:#888;font-size:12px;">Size: ${productSize}</span>`
                            : ''
                    }
                </td>
                <td style="padding:14px 8px;border-bottom:1px solid #eee;text-align:center;font-size:14px;">
                    ${quantity}
                </td>
                <td style="padding:14px 8px;border-bottom:1px solid #eee;text-align:right;font-size:14px;">
                    ${formatNaira(price)}
                </td>
                <td style="padding:14px 8px;border-bottom:1px solid #eee;text-align:right;font-size:14px;">
                    <strong>${formatNaira(itemTotal)}</strong>
                </td>
            </tr>
        `;
    }).join('');

    // -----------------------------------
    // PAYMENT EMAIL
    // -----------------------------------

    const mailOptions = {
        from: `"CapCentral" <${process.env.EMAIL_USER}>`,
        to: customerInfo.email,
        subject: `Payment Successful - ${orderReference}`,
        text: `
Hello ${customerInfo.name || 'Customer'},

Your payment was successful.

Order reference: ${orderReference}

Items purchased:
${products.map(product =>
    `${product.name || product.title || 'Product'} - Quantity: ${Math.max(1, Number(product.quantity) || 1)} - ${formatNaira(product.price)} each`
).join('\n')}

Subtotal: ${formatNaira(subtotal)}
${isExpress ? `Express delivery: ${formatNaira(surcharge)}\n` : ''}
Total paid: ${formatNaira(totalPaid)}

Delivery: ${deliveryName}
Estimated delivery: ${deliveryDateText}

Thank you for shopping with CapCentral.
        `.trim(),
        html: `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CapCentral Payment Confirmation</title>
</head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#222;">
    <div style="padding:24px 10px;">
        <div style="max-width:650px;margin:auto;background:#fff;border-radius:14px;overflow:hidden;">

            <div style="background:linear-gradient(135deg,#007bff,#0056d6);padding:30px 20px;text-align:center;color:#fff;">
                <div style="font-size:30px;font-weight:bold;">CapCentral</div>
                <div style="margin-top:8px;font-size:14px;">Your trusted cap store</div>
            </div>

            <div style="padding:30px 24px 12px;text-align:center;">
                <div style="width:60px;height:60px;margin:auto;border-radius:50%;background:#e9f9ef;color:#28a745;font-size:34px;line-height:60px;">✓</div>
                <h1 style="font-size:25px;margin:18px 0 8px;">Payment Successful!</h1>
                <p style="color:#666;line-height:1.6;margin:0;">
                    Thank you, ${customerName}. Your CapCentral order has been received.
                </p>
            </div>

            <div style="margin:20px 24px;padding:18px;background:#f5f9ff;border-radius:10px;text-align:center;">
                <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:1px;">Order Reference</div>
                <div style="margin-top:7px;color:#007bff;font-size:18px;font-weight:bold;">${safeReference}</div>
            </div>

            <div style="padding:10px 24px 24px;">
                <h2 style="font-size:18px;margin-bottom:14px;">Items Purchased</h2>
                <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                    <thead>
                        <tr style="background:#f7f7f7;">
                            <th style="padding:10px 8px;text-align:left;font-size:11px;color:#777;">ITEM</th>
                            <th style="padding:10px 8px;text-align:center;font-size:11px;color:#777;">QTY</th>
                            <th style="padding:10px 8px;text-align:right;font-size:11px;color:#777;">PRICE</th>
                            <th style="padding:10px 8px;text-align:right;font-size:11px;color:#777;">TOTAL</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${productRows}
                    </tbody>
                </table>
            </div>

            <div style="margin:0 24px;padding:20px;background:#fafafa;border-radius:10px;">
                <div style="display:flex;justify-content:space-between;margin-bottom:10px;color:#666;font-size:14px;">
                    <span>Subtotal</span>
                    <strong>${formatNaira(subtotal)}</strong>
                </div>

                ${
                    isExpress
                        ? `<div style="display:flex;justify-content:space-between;margin-bottom:10px;color:#666;font-size:14px;">
                            <span>Express Delivery</span>
                            <strong>${formatNaira(surcharge)}</strong>
                           </div>`
                        : ''
                }

                <div style="border-top:1px solid #ddd;margin-top:14px;padding-top:14px;display:flex;justify-content:space-between;font-size:18px;">
                    <strong>Total Paid</strong>
                    <strong style="color:#007bff;">${formatNaira(totalPaid)}</strong>
                </div>
            </div>

            <div style="margin:24px;padding:20px;border-radius:10px;background:${isExpress ? '#fff7e6' : '#eef7ff'};border-left:5px solid ${isExpress ? '#ff9800' : '#007bff'};">
                <div style="font-size:12px;color:#777;text-transform:uppercase;">Delivery Information</div>
                <h3 style="margin:8px 0;">${deliveryName}</h3>
                <p style="color:#555;font-size:14px;line-height:1.6;">${deliveryMessage}</p>
                <p style="font-size:14px;"><strong>Estimated delivery:</strong> ${deliveryDateText}</p>
            </div>

            <div style="padding:8px 24px 28px;text-align:center;">
                <h2 style="font-size:19px;">Thank You for Shopping with CapCentral!</h2>
                <p style="font-size:14px;color:#777;line-height:1.6;">
                    We appreciate your business. We will keep you updated about your order.
                </p>
            </div>

            <div style="background:#f7f8fa;padding:18px;text-align:center;color:#999;font-size:12px;">
                <p>© ${new Date().getFullYear()} CapCentral</p>
                <p>This email confirms your successful payment.</p>
            </div>

        </div>
    </div>
</body>
</html>
        `,
    };

    try {
        const info = await transporter.sendMail(mailOptions);

        console.log(
            `Payment confirmation email sent to ${customerInfo.email}. Message ID: ${info.messageId}`
        );

        return orderReference;
    } catch (error) {
        console.error(
            'Error sending payment confirmation email:',
            error.message
        );

        throw error;
    }
};

// =====================================================
// SERVICE PAYMENT CONFIRMATION EMAIL (WITH PDF)
// =====================================================

const sendPaymentConfirmationEmail = async (serviceData, pdfFilePath) => {
    if (!serviceData?.email) {
        throw new Error('Service customer email is missing.');
    }

    const customerName = escapeEmailHtml(
        serviceData.name || 'Customer'
    );

    const mailOptions = {
        from: `"CapCentral" <${process.env.EMAIL_USER}>`,
        to: serviceData.email,
        subject: 'CapCentral Service Payment Confirmation',
        html: `
            <div style="font-family:Arial,sans-serif;background:#f9f9f9;padding:30px;">
                <div style="max-width:600px;margin:auto;background:#fff;border-radius:10px;padding:30px;">
                    <h2>Hello ${customerName},</h2>
                    <p>Your service payment has been successfully processed.</p>
                    <p>Your PDF receipt is attached for your records.</p>
                    <p>Thank you for choosing <strong>CapCentral</strong>.</p>
                    <hr>
                    <p style="font-size:13px;color:#888;">
                        Need help? Contact capcentraldesk@gmail.com.
                    </p>
                </div>
            </div>
        `,
        attachments: pdfFilePath
            ? [{
                filename: `service_payment_confirmation_${serviceData.reference_id || 'receipt'}.pdf`,
                path: pdfFilePath,
                contentType: 'application/pdf',
            }]
            : [],
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Service payment confirmation sent to ${serviceData.email}`);
    } catch (error) {
        console.error('Error sending service payment confirmation:', error.message);
        throw error;
    }
};

// =====================================================
// EMAIL VERIFICATION
// =====================================================

const sendVerificationEmail = async (email) => {
    const token = jwt.sign(
        { email },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );

    const baseUrl =
        process.env.APP_BASE_URL || 'http://192.168.0.101:8000';

    const verificationLink =
        `${baseUrl}/verify-email?token=${encodeURIComponent(token)}`;

    const mailOptions = {
        from: `"CapCentral" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Verify Your Email',
        html: `
            <p>Click below to verify your email address:</p>
            <a href="${verificationLink}"
               style="padding:10px 20px;background:#007BFF;color:white;text-decoration:none;border-radius:5px;">
                Verify Email
            </a>
            <p>If you did not sign up, you can ignore this email.</p>
        `,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Verification email sent to ${email}`);
    } catch (error) {
        console.error('Error sending verification email:', error.message);
        throw error;
    }
};

// =====================================================
// PASSWORD RESET EMAIL
// =====================================================

const sendPasswordResetEmail = async (email) => {
    const token = jwt.sign(
        { email },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
    );

    const baseUrl =
        process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 8000}`;

    const resetLink =
        `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;

    const mailOptions = {
        from: `"CapCentral" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Password Reset Request',
        html: `
            <p>You requested to reset your password.</p>
            <a href="${resetLink}"
               style="padding:10px 20px;background:#dc3545;color:white;text-decoration:none;border-radius:5px;">
                Reset Password
            </a>
            <p>If you did not request this, you can ignore this email.</p>
        `,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Password reset email sent to ${email}`);
    } catch (error) {
        console.error('Error sending password reset email:', error.message);
        throw error;
    }
};

// =====================================================
// ORDER STATUS UPDATE EMAIL
// =====================================================

const sendOrderStatusUpdateEmail = async (order, newStatus) => {
    if (!order?.customer_email) {
        throw new Error('Order has no customer email address.');
    }

    const name = escapeEmailHtml(order.customer_name || 'Customer');
    const reference = escapeEmailHtml(
        order.order_reference || `Order #${order.id}`
    );
    const status = escapeEmailHtml(
        String(newStatus || 'updated').replace(/_/g, ' ')
    );

    const mailOptions = {
        from: `"CapCentral" <${process.env.EMAIL_USER}>`,
        to: order.customer_email,
        subject: `Order Update - ${reference}`,
        text: `Hello ${order.customer_name || 'Customer'}, your order ${order.order_reference || `#${order.id}`} is now ${newStatus}.`,
        html: `
            <div style="font-family:Arial,sans-serif;padding:24px;">
                <h2>CapCentral Order Update</h2>
                <p>Hello ${name},</p>
                <p>Your order <strong>${reference}</strong> status has changed to <strong>${status}</strong>.</p>
                <p>Thank you for shopping with CapCentral.</p>
            </div>
        `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Order status email sent to ${order.customer_email}`);
};

// =====================================================
// DELIVERY UPDATE EMAIL
// =====================================================

const sendDeliveryUpdateEmail = async (order) => {
    if (!order?.customer_email) {
        throw new Error('Order has no customer email address.');
    }

    const name = escapeEmailHtml(order.customer_name || 'Customer');
    const reference = escapeEmailHtml(
        order.order_reference || `Order #${order.id}`
    );
    const tracking = escapeEmailHtml(
        order.tracking_number || 'Not yet assigned'
    );
    const option = escapeEmailHtml(
        order.delivery_option || 'standard'
    );
    const address = escapeEmailHtml(
        order.delivery_address || 'Not provided'
    );
    const dispatch = escapeEmailHtml(
        order.dispatch_date || 'Not scheduled'
    );
    const delivered = escapeEmailHtml(
        order.delivered_at || 'Not delivered yet'
    );
    const notes = escapeEmailHtml(
        order.delivery_notes || 'No additional notes'
    );

    const mailOptions = {
        from: `"CapCentral" <${process.env.EMAIL_USER}>`,
        to: order.customer_email,
        subject: `Delivery Update - ${reference}`,
        text: `Hello ${order.customer_name || 'Customer'}, delivery details for order ${order.order_reference || `#${order.id}`} have been updated. Tracking: ${order.tracking_number || 'Not yet assigned'}.`,
        html: `
            <div style="font-family:Arial,sans-serif;padding:24px;">
                <h2>CapCentral Delivery Update</h2>
                <p>Hello ${name},</p>
                <p>The delivery details for order <strong>${reference}</strong> have been updated.</p>
                <p><strong>Tracking number:</strong> ${tracking}</p>
                <p><strong>Delivery option:</strong> ${option}</p>
                <p><strong>Delivery address:</strong> ${address}</p>
                <p><strong>Dispatch date:</strong> ${dispatch}</p>
                <p><strong>Delivered at:</strong> ${delivered}</p>
                <p><strong>Notes:</strong> ${notes}</p>
                <p>Thank you for choosing CapCentral.</p>
            </div>
        `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Delivery update email sent to ${order.customer_email}`);
};

// =====================================================
// EXPORTS
// =====================================================

module.exports = {
    sendPaymentConfirmationEmail,
    sendProductPaymentConfirmationEmail,
    sendVerificationEmail,
    sendPasswordResetEmail,
    sendOrderStatusUpdateEmail,
    sendDeliveryUpdateEmail,
};
