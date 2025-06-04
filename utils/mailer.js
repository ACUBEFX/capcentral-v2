const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const fs = require('fs');

// Set up nodemailer transporter with environment variables
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

// For product/basket payment confirmation (with or without PDF)

const sendProductPaymentConfirmationEmail = async (customerInfo, products, totalAmount, pdfFilePath = null) => {
    const reference = Date.now() + '_' + Math.floor(Math.random() * 1000);
    // Build product table HTML
    const itemsHtml = products.map(
        (item, idx) => `
        <tr>
            <td style="padding:8px 12px;border:1px solid #eee;">${idx + 1}</td>
            <td style="padding:8px 12px;border:1px solid #eee;">${item.name}</td>
            <td style="padding:8px 12px;border:1px solid #eee;">${item.size || '-'}</td>
            <td style="padding:8px 12px;border:1px solid #eee;">₦${item.price.toLocaleString()}</td>
        </tr>
        `
    ).join('');
    const tableHtml = `
        <table style="width:100%;border-collapse:collapse;margin-top:20px;">
            <thead>
                <tr>
                    <th style="padding:8px 12px;border:1px solid #eee;">#</th>
                    <th style="padding:8px 12px;border:1px solid #eee;">Product</th>
                    <th style="padding:8px 12px;border:1px solid #eee;">Size</th>
                    <th style="padding:8px 12px;border:1px solid #eee;">Price</th>
                </tr>
            </thead>
            <tbody>
                ${itemsHtml}
            </tbody>
        </table>
    `;

    const mailOptions = {
        from: `"CapCentral" <${process.env.EMAIL_USER}>`,
        to: customerInfo.email,
        subject: 'CapCentral Payment Confirmation',
        html: `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f9f9f9; padding: 30px;">
                <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 10px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); padding: 30px;">
                    <h2 style="color: #333333;">Hello ${customerInfo.name || 'Customer'},</h2>
                    <p style="font-size: 16px; color: #555555; line-height: 1.6;">
                        Your payment has been <strong style="color: #28a745;">successfully processed</strong>.
                    </p>
                    <p style="font-size: 16px; color: #555555; line-height: 1.6;">
                        <strong>Order reference:</strong> ${reference}
                    </p>
                    ${tableHtml}
                    <p style="font-size: 16px; color: #555555; line-height: 1.6;margin-top:14px;">
                        <strong>Total Paid:</strong> ₦${(totalAmount / 100).toLocaleString()}
                    </p>
                    <hr style="border: none; border-top: 1px solid #eeeeee; margin: 30px 0;" />
                    <p style="font-size: 14px; color: #999999; text-align: center;">
                        Need help? Contact us at <a href="mailto:capcentraldesk@gmail.com" style="color: #007bff;">support@capcentral.com</a>
                    </p>
                </div>
            </div>
        `,
        attachments: pdfFilePath
            ? [
                  {
                      filename: `order_receipt_${reference}.pdf`,
                      path: pdfFilePath,
                      contentType: 'application/pdf',
                  },
              ]
            : [],
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('✅ Product payment confirmation email sent successfully');
    } catch (error) {
        console.error('❌ Error sending product payment confirmation email:', error.message);
        throw error;
    }
};

// --- Your original service email + verification/password reset functions remain unchanged ---

// Send Payment Confirmation Email for services (with PDF Attachment)
const sendPaymentConfirmationEmail = async (serviceData, pdfFilePath) => {
    const mailOptions = {
        from: `"CapCentral" <${process.env.EMAIL_USER}>`,
        to: serviceData.email,
        subject: 'CapCentral Service Payment Confirmation',
        html: `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f9f9f9; padding: 30px;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 10px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); padding: 30px;">
<h2 style="color: #333333;">Hello ${serviceData.name},</h2>
    <p style="font-size: 16px; color: #555555; line-height: 1.6;">
      We're excited to let you know that your payment has been <strong style="color: #28a745;">successfully processed</strong>.
    </p>
    <p style="font-size: 16px; color: #555555; line-height: 1.6;">
      For your records, we've attached a PDF receipt that contains all the important details.
    </p>
    <p style="font-size: 16px; color: #555555; line-height: 1.6;">
      Thank you for choosing <span style="color: #007bff;"><strong>CapCentral</strong></span> – we’re proud to serve you!
    </p>
    <hr style="border: none; border-top: 1px solid #eeeeee; margin: 30px 0;" />
    <p style="font-size: 14px; color: #999999; text-align: center;">
      Need help? Contact us at <a href="mailto:capcentraldesk@gmail.com" style="color: #007bff;">support@capcentral.com</a>
    </p>
  </div>
</div>
        `,
        attachments: [
            {
                filename: `service_payment_confirmation_${serviceData.reference_id}.pdf`,
                path: pdfFilePath,
                contentType: 'application/pdf',
            }
        ]
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('✅ Payment confirmation email sent successfully');
    } catch (error) {
        console.error('❌ Error sending payment confirmation email:', error.message);
        throw error;
    }
};

// Send Email Verification Email with JWT Token
const sendVerificationEmail = async (email) => {
    const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const link = `http://localhost:${process.env.PORT}/verify-email?token=${token}`;

    const mailOptions = {
        from: `"CapCentral" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Verify Your Email',
        html: `
            <p>Click the button below to verify your email address:</p>
            <a href="${link}" 
                style="padding:10px 20px; background:#007BFF; color:white; text-decoration:none; border-radius:5px;">
                Verify Email
            </a>
            <p style="margin-top:20px; font-size:14px; color:#666;">
                If you did not sign up, you can ignore this message.
            </p>
        `,
    };

    try {
        await transporter.sendMail(mailOptions);
    } catch (error) {
        console.error('❌ Error sending verification email:', error.message);
        throw new Error('Failed to send verification email.');
    }
};

// Send Password Reset Email with JWT Token
const sendPasswordResetEmail = async (email) => {
    const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '24h' });
    const resetLink = `http://localhost:${process.env.PORT}/reset-password?token=${token}`;

    const mailOptions = {
        from: `"CapCentral" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Password Reset Request',
        html: `
            <p>You requested to reset your password. Click the link below to continue:</p>
            <a href="${resetLink}" 
                style="padding:10px 20px; background:#dc3545; color:white; text-decoration:none; border-radius:5px;">
                Reset Password
            </a>
            <p style="margin-top:20px; font-size:14px; color:#666;">
                If you didn't request this, just ignore this email.
            </p>
        `,
    };

    try {
        await transporter.sendMail(mailOptions);
    } catch (error) {
        console.error('❌ Error sending password reset email:', error.message);
        throw new Error('Failed to send password reset email.');
    }
};

module.exports = {
    sendPaymentConfirmationEmail,
    sendProductPaymentConfirmationEmail,
    sendVerificationEmail,
    sendPasswordResetEmail
};