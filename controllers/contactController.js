const nodemailer = require('nodemailer');

const handleContactForm = async (req, res) => {
    const { userName, userEmail, subject, message } = req.body;


    if (!userName || !userEmail || !message) {
        return res.status(400).send('Name, Email and message are required.');
    }

    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
        });

        await transporter.sendMail({
            from: `"Contact Form" <${process.env.EMAIL_USER}>`,
            to: process.env.EMAIL_USER,
            replyTo: userEmail, // FIXED: was "email", should be "userEmail"
            subject: subject || "New Contact Message",
            html: `
              <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                <h2 style="color: #1a73e8;">New Contact Form Submission</h2>
                <p><strong>Sender's Name:</strong> ${userName}</p> <!-- FIXED: was "name" -->
                <p><strong>Sender's Email:</strong> <a href="mailto:${userEmail}" style="color: #1a73e8;">${userEmail}</a></p>
                <p><strong>Subject:</strong> ${subject}</p>
                <hr style="margin: 20px 0;" />
                <div style="background-color: #f9f9f9; padding: 15px; border-left: 4px solid #1a73e8;">
                  <p style="white-space: pre-line; margin: 0;">${message}</p>
                </div>
                <p style="margin-top: 30px; font-size: 12px; color: #888;">This message was sent via the Cap Central contact form.</p>
              </div>
            `
        });

res.redirect('/?message=success');
    } catch (error) {
        console.error('Email sending error:', error);
        res.status(500).send('Failed to send message.');
    }
};

module.exports = { handleContactForm };
