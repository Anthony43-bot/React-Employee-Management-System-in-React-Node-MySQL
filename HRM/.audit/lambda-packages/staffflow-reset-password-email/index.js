const { neon } = require('@neondatabase/serverless');
const https = require('https');

const sql = neon(process.env.DATABASE_URL);
const ZEPTOMAIL_API_KEY = process.env.ZEPTOMAIL_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@stafflow.bz';
const COMPANY_LOGO_URL = process.env.COMPANY_LOGO_URL || 'https://internal-public-images.s3.us-east-1.amazonaws.com/Stafflow+logo+(1)+(1).png';

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendEmailViaZeptoMail(to, subject, html) {
  const payload = JSON.stringify({
    from: { address: FROM_EMAIL },
    to: [{ email_address: { address: to } }],
    subject: subject,
    htmlbody: html,
  });
  const options = {
    hostname: 'api.zeptomail.com',
    port: 443,
    path: '/v1.1/email',
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': ZEPTOMAIL_API_KEY,
      'Content-Length': Buffer.byteLength(payload),
    },
  };
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`ZeptoMail error: ${res.statusCode} - ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function getPasswordResetHtml(code) {
  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"></head>
    <body>
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #4F46E5, #9333EA); padding: 20px; text-align: center;">
          <h1 style="color: white;">Reset Your Password</h1>
        </div>
        <div style="padding: 20px;">
          <p>We received a request to reset your password.</p>
          <p style="font-size: 24px; font-weight: bold; text-align: center;">${code}</p>
          <p>Enter this code on the reset page to set a new password.</p>
          <p>If you didn't request this, please ignore this email.</p>
          <hr />
          <p style="font-size: 12px; color: #666;">Staff Flow HRM</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

module.exports.handler = async (event) => {
  console.log('🔵 Password reset email Lambda triggered');
  for (const record of event.Records) {
    const { email, code } = JSON.parse(record.body);
    const subject = 'Reset Your Password - Staff Flow HRM';
    const html = getPasswordResetHtml(code);
    await sendEmailViaZeptoMail(email, subject, html);
    console.log(`✅ Password reset email sent to ${email}`);
  }
};