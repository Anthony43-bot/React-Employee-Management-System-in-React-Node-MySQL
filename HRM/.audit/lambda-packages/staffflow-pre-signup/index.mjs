import { neon } from '@neondatabase/serverless';
import https from 'https';

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
          reject(new Error(`ZeptoMail API error: ${res.statusCode} - ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function getSignUpHtml(code) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f5f5f5; }
        .container { max-width: 600px; margin: 20px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        .header { background: linear-gradient(135deg, #4F46E5, #9333EA); padding: 30px; text-align: center; }
        .header img { max-width: 150px; margin-bottom: 10px; }
        .header h1 { color: white; margin: 0; font-size: 28px; }
        .content { padding: 30px; }
        .code { background: #f3f4f6; padding: 15px; border-radius: 8px; font-family: monospace; font-size: 24px; font-weight: bold; text-align: center; color: #4F46E5; letter-spacing: 2px; margin: 20px 0; }
        .info-box { background: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #4F46E5; }
        hr { margin: 30px 0; border: none; border-top: 1px solid #e5e7eb; }
        .footer { font-size: 12px; color: #6b7280; text-align: center; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <img src="${COMPANY_LOGO_URL}" alt="Staff Flow Logo" />
          <h1>Verify Your Email</h1>
        </div>
        <div class="content">
          <p>Hello,</p>
          <p>Welcome to <strong>Staff Flow HRM</strong>! To complete your account setup, please verify your email address.</p>
          <div class="info-box">
            <h3 style="margin-top: 0; color: #4F46E5;">Your Verification Code:</h3>
            <div class="code">${code}</div>
            <p>This code will expire in 1 hour. Please use it to verify your email address.</p>
          </div>
          <p>If you didn't request this verification, please ignore this email.</p>
          <hr />
          <p class="footer">This is an automated message from Staff Flow HRM. If you have any questions, please contact support.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

export const handler = async (event) => {
  console.log('🔵 Pre sign-up triggered:', event.triggerSource);
  const email = event.request.userAttributes.email;
  if (!email) return event;

  try {
    const code = generateCode();
    await sql`
      INSERT INTO pending_verifications (email, code, expires_at)
      VALUES (${email}, ${code}, NOW() + INTERVAL '1 hour')
      ON CONFLICT (email) DO UPDATE SET
        code = ${code},
        expires_at = NOW() + INTERVAL '1 hour',
        created_at = NOW()
    `;
    console.log(`Inserted expires_at: ${new Date(Date.now() + 3600000).toISOString()}`);
    const subject = 'Verify Your Email - Staff Flow HRM';
    const html = getSignUpHtml(code);
    await sendEmailViaZeptoMail(email, subject, html);
    console.log(`✅ Verification email sent to ${email}`);
  } catch (error) {
    console.error('❌ Error in pre-signup Lambda:', error);
  }
  return event;
};