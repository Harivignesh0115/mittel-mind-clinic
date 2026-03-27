const https = require('https');

const normalizePhone = (phone) => {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `91${digits}`; // default to India for local numbers
  return digits;
};

const buildTextMessage = (data) => ([
  'Appointment Confirmed',
  '',
  `👤 Name: ${data.name}`,
  `📞 Phone: ${data.phone}`,
  `📧 Email: ${data.email || ''}`,
  `🩺 Concern: ${data.concern || 'General consultation'}`,
  `📅 Date: ${data.date}`,
  `🕐 Time: ${data.time}`,
  '',
  'Thank you!'
].join('\n'));

const requestJson = (options, body) => new Promise((resolve, reject) => {
  const req = https.request(options, res => {
    let raw = '';
    res.on('data', chunk => { raw += chunk; });
    res.on('end', () => {
      try {
        const parsed = raw ? JSON.parse(raw) : {};
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ success: true, data: parsed });
        } else {
          resolve({ success: false, data: parsed, status: res.statusCode });
        }
      } catch (err) {
        reject(err);
      }
    });
  });
  req.on('error', reject);
  req.write(JSON.stringify(body));
  req.end();
});

const sendWhatsAppConfirmation = async (appointment) => {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME;
  const templateLang = process.env.WHATSAPP_TEMPLATE_LANG || 'en_US';

  if (!token || !phoneId) {
    return { success: false, message: 'WhatsApp not configured' };
  }

  const to = normalizePhone(appointment.phone);
  if (!to) {
    return { success: false, message: 'Invalid recipient phone number' };
  }

  const body = templateName ? {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: templateLang },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: appointment.name },
            { type: 'text', text: appointment.date },
            { type: 'text', text: appointment.time }
          ]
        }
      ]
    }
  } : {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { preview_url: false, body: buildTextMessage(appointment) }
  };

  const options = {
    hostname: 'graph.facebook.com',
    path: `/v19.0/${phoneId}/messages`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  };

  try {
    const result = await requestJson(options, body);
    if (!result.success) {
      return { success: false, message: 'WhatsApp send failed', details: result.data };
    }
    return { success: true, data: result.data };
  } catch (err) {
    return { success: false, message: err.message };
  }
};

module.exports = { sendWhatsAppConfirmation };
