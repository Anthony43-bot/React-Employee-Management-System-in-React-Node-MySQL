import https from 'https';
import { KmsKeyringNode, buildClient, CommitmentPolicy } from '@aws-crypto/client-node';

const ZEPTOMAIL_API_KEY = process.env.ZEPTOMAIL_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@stafflow.bz';
const COMPANY_LOGO_URL =
  process.env.COMPANY_LOGO_URL ||
  'https://internal-public-images.s3.us-east-1.amazonaws.com/Staffflow+logo+(1)+(1).png';

const KMS_KEY_ARN = process.env.KMS_KEY_ARN;

// AWS Encryption SDK client
const { decrypt } = buildClient(CommitmentPolicy.REQUIRE_ENCRYPT_ALLOW_DECRYPT);

if (!ZEPTOMAIL_API_KEY) {
  throw new Error('Missing ZEPTOMAIL_API_KEY');
}
if (!FROM_EMAIL) {
  throw new Error('Missing FROM_EMAIL');
}
if (!KMS_KEY_ARN) {
  throw new Error('Missing KMS_KEY_ARN');
}

async function decryptCode(encryptedCode) {
  const keyring = new KmsKeyringNode({
    keyIds: [KMS_KEY_ARN],
    generatorKeyId: KMS_KEY_ARN,
  });

  // Cognito passes base64-encoded encrypted bytes
  const ciphertext = Buffer.from(encryptedCode, 'base64');

  const { plaintext } = await decrypt(keyring, ciphertext);

  // Cognito code is plaintext bytes after Encryption SDK decrypt
  return plaintext.toString('utf-8');
}

async function sendEmail(to, subject, html) {
  const payload = JSON.stringify({
    from: { address: FROM_EMAIL },
    to: [{ email_address: { address: to } }],
    subject,
    htmlbody: html,
  });

  const options = {
    hostname: 'api.zeptomail.com',
    port: 443,
    path: '/v1.1/email',
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: ZEPTOMAIL_API_KEY,
      'Content-Length': Buffer.byteLength(payload),
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          resolve(data);
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

function getBaseEmailHtml({ heading, intro, label, code, note, closing }) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
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
          <h1>${heading}</h1>
        </div>
        <div class="content">
          <p>Hello,</p>
          <p>${intro}</p>
          <div class="info-box">
            <h3 style="margin-top: 0; color: #4F46E5;">${label}</h3>
            <div class="code">${code}</div>
            <p>${note}</p>
          </div>
          <p>${closing}</p>
          <hr />
          <p class="footer">This is an automated message from Staff Flow HRM. If you have any questions, please contact support.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function getSignupVerificationEmailHtml(code) {
  return getBaseEmailHtml({
    heading: 'Verify Your Email',
    intro: 'Welcome to <strong>Staff Flow HRM</strong>! To complete your account setup, please verify your email address.',
    label: 'Your Verification Code:',
    code,
    note: 'This code will expire soon. Please use it to verify your email address.',
    closing: "If you didn't request this verification, please ignore this email.",
  });
}

function getPasswordResetEmailHtml(code) {
  return getBaseEmailHtml({
    heading: 'Reset Your Password',
    intro: 'We received a request to reset the password for your <strong>Staff Flow HRM</strong> account.',
    label: 'Your Password Reset Code:',
    code,
    note: 'This code will expire soon. Enter it on the password reset page to create a new password.',
    closing: "If you didn't request a password reset, you can safely ignore this email. Your password will not change unless this code is used.",
  });
}

function getEmailContent(triggerSource, code) {
  if (triggerSource === 'CustomEmailSender_ForgotPassword') {
    return {
      subject: 'Reset Your Password - Staff Flow HRM',
      html: getPasswordResetEmailHtml(code),
    };
  }

  return {
    subject: 'Verify Your Email - Staff Flow HRM',
    html: getSignupVerificationEmailHtml(code),
  };
}

export const handler = async (event) => {
  console.log('Trigger:', event.triggerSource);

  try {
    const email = event?.request?.userAttributes?.email;
    const encryptedCode = event?.request?.code;

    if (!email) {
      throw new Error('Missing recipient email in Cognito event');
    }

    if (!encryptedCode) {
      console.log('No encrypted code present for trigger:', event.triggerSource);
      return event;
    }

    const code = await decryptCode(encryptedCode);
    const emailContent = getEmailContent(event.triggerSource, code);

    await sendEmail(
      email,
      emailContent.subject,
      emailContent.html
    );

    console.log('Email sent successfully to:', email);
    return event;
  } catch (error) {
    console.error('Custom email sender failed:', {
      triggerSource: event?.triggerSource,
      message: error?.message,
      name: error?.name,
    });
    throw error;
  }
};
