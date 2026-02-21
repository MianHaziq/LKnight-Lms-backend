const nodemailer = require('nodemailer');

// Helper: Send email
const sendEmail = async (to, subject, html) => {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: process.env.FROM_EMAIL,
    to,
    subject,
    html,
  });
};

// Subject label mapping
const subjectLabels = {
  general: 'General Inquiry',
  support: 'Technical Support',
  sales: 'Course Enrollment',
  other: 'Other',
};

// POST /api/contact
const submitContact = async (req, res, next) => {
  try {
    const { firstName, lastName, email, phone, subject, message } = req.body;

    if (!firstName || !email || !message) {
      return res.status(400).json({
        success: false,
        message: 'First name, email, and message are required',
      });
    }

    const subjectLabel = subjectLabels[subject] || 'General Inquiry';
    const contactEmail = process.env.CONTACT_EMAIL || 'inquiries@lknightproductions.com';

    // Send notification to business
    await sendEmail(
      contactEmail,
      `New Contact Form: ${subjectLabel} from ${firstName} ${lastName || ''}`,
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #000E51; padding: 24px; border-radius: 8px 8px 0 0;">
            <h2 style="color: white; margin: 0;">New Contact Form Submission</h2>
          </div>
          <div style="padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #6b7280; width: 120px;"><strong>Name:</strong></td>
                <td style="padding: 8px 0; color: #111827;">${firstName} ${lastName || ''}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;"><strong>Email:</strong></td>
                <td style="padding: 8px 0; color: #111827;"><a href="mailto:${email}">${email}</a></td>
              </tr>
              ${phone ? `
              <tr>
                <td style="padding: 8px 0; color: #6b7280;"><strong>Phone:</strong></td>
                <td style="padding: 8px 0; color: #111827;"><a href="tel:${phone}">${phone}</a></td>
              </tr>
              ` : ''}
              <tr>
                <td style="padding: 8px 0; color: #6b7280;"><strong>Subject:</strong></td>
                <td style="padding: 8px 0; color: #111827;">${subjectLabel}</td>
              </tr>
            </table>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
            <p style="color: #6b7280; margin-bottom: 4px;"><strong>Message:</strong></p>
            <p style="color: #111827; white-space: pre-wrap; line-height: 1.6;">${message}</p>
          </div>
        </div>
      `
    );

    // Send confirmation to user
    await sendEmail(
      email,
      'Thank you for contacting LKnight Learning Hub',
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #000E51; padding: 24px; border-radius: 8px 8px 0 0; text-align: center;">
            <h2 style="color: white; margin: 0;">LKnight Learning Hub</h2>
          </div>
          <div style="padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
            <p style="color: #111827; font-size: 16px;">Hi ${firstName},</p>
            <p style="color: #4b5563; line-height: 1.6;">
              Thank you for reaching out to us! We have received your message and our team will get back to you within 24-48 hours.
            </p>
            <p style="color: #4b5563; line-height: 1.6;">
              If your inquiry is urgent, feel free to call us at <a href="tel:+18329535517" style="color: #FF6F00;">(832) 953-5517</a>.
            </p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
            <p style="color: #9ca3af; font-size: 12px; text-align: center;">
              LKnight Productions &bull; 7312 Louetta Rd. Ste. B118-160, Spring, Texas 77379
            </p>
          </div>
        </div>
      `
    );

    res.status(200).json({
      success: true,
      message: 'Message sent successfully. We will get back to you soon!',
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { submitContact };
