const nodemailer = require('nodemailer');

const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    tls: {
      rejectUnauthorized: false
    }
  });
};

const sendAppointmentConfirmation = async (appointmentData) => {
  try {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.log('📧 Email service not configured. Skipping email send.');
      return { success: false, message: 'Email not configured' };
    }

    const transporter = createTransporter();

    // Email to patient
    const patientMailOptions = {
      from: `"Mittel Mind Clinic" <${process.env.SMTP_USER}>`,
      to: appointmentData.email,
      subject: '✅ Appointment Confirmed – Mittel Mind Clinic',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: 'Arial', sans-serif; background: #f8fafc; margin: 0; padding: 20px; }
            .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
            .header { background: linear-gradient(135deg, #0EA5E9, #0284c7); padding: 40px 30px; text-align: center; }
            .header h1 { color: white; margin: 0; font-size: 24px; letter-spacing: 1px; }
            .header p { color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px; }
            .body { padding: 36px 30px; }
            .greeting { font-size: 18px; color: #1e293b; margin-bottom: 16px; }
            .card { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 12px; padding: 24px; margin: 24px 0; }
            .card h3 { color: #0EA5E9; margin: 0 0 16px; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; }
            .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e0f2fe; }
            .detail-row:last-child { border-bottom: none; }
            .detail-label { color: #64748b; font-size: 13px; }
            .detail-value { color: #1e293b; font-weight: 600; font-size: 13px; }
            .notice { background: #fff7ed; border-left: 4px solid #f59e0b; padding: 16px; border-radius: 8px; margin: 20px 0; }
            .notice p { color: #92400e; margin: 0; font-size: 13px; line-height: 1.6; }
            .footer { background: #f8fafc; padding: 24px 30px; text-align: center; border-top: 1px solid #e2e8f0; }
            .footer p { color: #94a3b8; font-size: 12px; margin: 4px 0; }
            .clinic-name { color: #0EA5E9; font-weight: 700; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>⚕️ MITTEL MIND CLINIC</h1>
              <p>Advanced Neuropsychiatry & Mental Wellness</p>
            </div>
            <div class="body">
              <p class="greeting">Dear ${appointmentData.name},</p>
              <p style="color: #475569; line-height: 1.6;">Your appointment has been successfully confirmed. We look forward to seeing you at Mittel Mind Clinic.</p>
              
              <div class="card">
                <h3>📋 Appointment Details</h3>
                <div class="detail-row">
                  <span class="detail-label">Patient Name</span>
                  <span class="detail-value">${appointmentData.name}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Date</span>
                  <span class="detail-value">${appointmentData.date}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Time</span>
                  <span class="detail-value">${appointmentData.time}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Contact</span>
                  <span class="detail-value">${appointmentData.phone}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Concern</span>
                  <span class="detail-value">${appointmentData.concern || 'General Consultation'}</span>
                </div>
              </div>

              <div class="notice">
                <p>⏰ <strong>Important:</strong> Please arrive 10 minutes before your scheduled time. If you need to reschedule or cancel, contact us at least 24 hours in advance.</p>
              </div>

              <p style="color: #475569; font-size: 14px; line-height: 1.6;">If you have any questions, please don't hesitate to reach out to us. We're here to support your mental wellness journey.</p>
            </div>
            <div class="footer">
              <p class="clinic-name">MITTEL MIND CLINIC</p>
              <p>Advanced Neuropsychiatry & Mental Wellness Center</p>
              <p>📞 Contact us for any queries regarding your appointment</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    // Email to clinic admin
    const adminMailOptions = {
      from: `"Mittel Mind Clinic System" <${process.env.SMTP_USER}>`,
      to: process.env.CLINIC_EMAIL || process.env.SMTP_USER,
      subject: `🔔 New Appointment – ${appointmentData.name} on ${appointmentData.date}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; background: #f8fafc; padding: 20px; border-radius: 12px;">
          <h2 style="color: #0EA5E9; border-bottom: 2px solid #0EA5E9; padding-bottom: 10px;">New Appointment Booked</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px; color: #64748b; font-size: 13px;">Name:</td><td style="padding: 8px; font-weight: 600; color: #1e293b;">${appointmentData.name}</td></tr>
            <tr style="background: #f1f5f9;"><td style="padding: 8px; color: #64748b; font-size: 13px;">Phone:</td><td style="padding: 8px; font-weight: 600; color: #1e293b;">${appointmentData.phone}</td></tr>
            <tr><td style="padding: 8px; color: #64748b; font-size: 13px;">Email:</td><td style="padding: 8px; font-weight: 600; color: #1e293b;">${appointmentData.email}</td></tr>
            <tr style="background: #f1f5f9;"><td style="padding: 8px; color: #64748b; font-size: 13px;">Date:</td><td style="padding: 8px; font-weight: 600; color: #1e293b;">${appointmentData.date}</td></tr>
            <tr><td style="padding: 8px; color: #64748b; font-size: 13px;">Time:</td><td style="padding: 8px; font-weight: 600; color: #1e293b;">${appointmentData.time}</td></tr>
            <tr style="background: #f1f5f9;"><td style="padding: 8px; color: #64748b; font-size: 13px;">Concern:</td><td style="padding: 8px; font-weight: 600; color: #1e293b;">${appointmentData.concern || 'General Consultation'}</td></tr>
          </table>
          <p style="color: #94a3b8; font-size: 12px; margin-top: 16px;">View full details in the Admin Dashboard.</p>
        </div>
      `
    };

    await transporter.sendMail(patientMailOptions);
    await transporter.sendMail(adminMailOptions);

    console.log(`📧 Confirmation emails sent to ${appointmentData.email}`);
    return { success: true, message: 'Emails sent successfully' };
  } catch (error) {
    console.error('Email send error:', error.message);
    return { success: false, message: error.message };
  }
};

module.exports = { sendAppointmentConfirmation };
