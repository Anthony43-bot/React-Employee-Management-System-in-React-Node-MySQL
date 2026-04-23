/**
 * Shared email utilities using ZeptoMail.
 */

const https = require('https');

const fromEmail = process.env.FROM_EMAIL || process.env.NOTIFICATIONS_FROM_EMAIL || process.env.SES_FROM_EMAIL || 'notifications@stafflow.bz';
const zeptoMailApiKey = process.env.ZEPTOMAIL_API_KEY || process.env.ZEPTO_NOTIFICATIONS_API_KEY;

function normalizeZeptoAuth(apiKey) {
  if (!apiKey) {
    throw new Error('Missing ZeptoMail API key');
  }
  return apiKey.startsWith('Zoho-enczapikey ') ? apiKey : `Zoho-enczapikey ${apiKey}`;
}

async function sendEmail(to, subject, body, isHtml = true) {
  const payload = {
    from: { address: fromEmail, name: 'Staff Flow HRM' },
    to: [{ email_address: { address: to } }],
    subject,
  };

  if (isHtml) {
    payload.htmlbody = body;
  } else {
    payload.textbody = body;
  }

  const postData = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.zeptomail.com',
      path: '/v1.1/email',
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: normalizeZeptoAuth(zeptoMailApiKey),
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          let result = {};
          try {
            result = JSON.parse(data);
          } catch {
            result = {};
          }

          resolve({
            success: true,
            messageId: result.data && result.data.message_id ? result.data.message_id : undefined,
          });
          return;
        }

        reject(new Error(`ZeptoMail API error ${res.statusCode}: ${data}`));
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function sendBulkEmails(emails) {
  const results = [];

  for (const email of emails) {
    try {
      const result = await sendEmail(email.to, email.subject, email.body, email.isHtml !== false);
      results.push({
        to: email.to,
        status: result.success ? 'success' : 'failed',
        error: result.error,
        messageId: result.messageId,
      });
    } catch (error) {
      results.push({
        to: email.to,
        status: 'failed',
        error: error.message,
      });
    }
  }

  return results;
}

async function sendTemplateEmail(to, templateName, templateData) {
  const body = `
    <h2>${templateName}</h2>
    <pre style="white-space:pre-wrap;font-family:Arial,sans-serif;">${JSON.stringify(templateData, null, 2)}</pre>
  `;
  return sendEmail(to, templateName, body, true);
}

module.exports = {
  sendEmail,
  sendBulkEmails,
  sendTemplateEmail,
  fromEmail,
};
