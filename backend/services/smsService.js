const https = require('https');

const normalizePhone = (phone) => {
  const raw = (phone || '').trim();
  if (!raw) return '';
  if (raw.startsWith('+')) return raw;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  const country = (process.env.SMS_DEFAULT_COUNTRY_CODE || '91').replace(/\D/g, '');
  if (digits.length === 10) return `+${country}${digits}`;
  return `+${digits}`;
};

const buildReminderMessage = (appointment) => {
  const name = appointment.name || 'Patient';
  const date = appointment.date || '';
  const time = appointment.time || '';
  return [
    `Reminder: Hi ${name},`,
    `Your appointment at Mittel Mind Clinic is scheduled for ${date} at ${time}.`,
    'Please arrive 10 minutes early. Reply or call if you need to reschedule.'
  ].join(' ');
};

const requestForm = (options, body) => new Promise((resolve, reject) => {
  const req = https.request(options, res => {
    let raw = '';
    res.on('data', chunk => { raw += chunk; });
    res.on('end', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        resolve({ success: true, data: raw });
      } else {
        resolve({ success: false, status: res.statusCode, data: raw });
      }
    });
  });
  req.on('error', reject);
  req.write(body);
  req.end();
});

const sendSmsReminder = async (appointment) => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !from) {
    return { success: false, message: 'SMS not configured' };
  }

  const to = normalizePhone(appointment.phone);
  if (!to) {
    return { success: false, message: 'Invalid recipient phone number' };
  }

  const body = new URLSearchParams({
    To: to,
    From: from,
    Body: buildReminderMessage(appointment)
  }).toString();

  const options = {
    hostname: 'api.twilio.com',
    path: `/2010-04-01/Accounts/${accountSid}/Messages.json`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
      'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64')
    }
  };

  try {
    const result = await requestForm(options, body);
    if (!result.success) {
      return { success: false, message: 'SMS send failed', details: result.data };
    }
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
};

module.exports = { sendSmsReminder };
