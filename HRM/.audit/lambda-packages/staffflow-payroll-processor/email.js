/**
 * Shared email utilities using ZeptoMail (CommonJS version for Lambda)
 * 
 * This replaces the previous AWS SES implementation.
 * All Lambda functions should import from this module.
 */

const https = require('https');

// ZeptoMail configuration
const ZEPTOMAIL_API_URL = 'https://api.zeptomail.com/v1.1/email';
const ZEPTOMAIL_API_KEY = process.env.ZEPTOMAIL_API_KEY;
const DEFAULT_FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@stafflow.bz';

// Agent-specific from emails (can be overridden per function)
const AGENT_FROM_EMAILS = {
  cognito: process.env.COGNITO_FROM_EMAIL || 'noreply@stafflow.bz',
  welcome: process.env.WELCOME_FROM_EMAIL || 'welcome@stafflow.bz',
  notifications: process.env.NOTIFICATIONS_FROM_EMAIL || 'notifications@stafflow.bz',
  bulk: process.env.BULK_FROM_EMAIL || 'noreply@stafflow.bz',
};

/**
 * Send a single email via ZeptoMail API
 */
async function sendEmail(to, subject, htmlBody, textBody = '', fromEmail = DEFAULT_FROM_EMAIL, recipientName = '') {
  return new Promise((resolve) => {
    const payload = {
      from: { address: fromEmail },
      to: [{ email_address: { address: to, name: recipientName || undefined } }],
      subject: subject,
      htmlbody: htmlBody,
    };

    if (textBody) {
      payload.textbody = textBody;
    }

    const postData = JSON.stringify(payload);
    
    const options = {
      hostname: 'api.zeptomail.com',
      path: '/v1.1/email',
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': ZEPTOMAIL_API_KEY,
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 15000,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          let result = {};
          try {
            result = JSON.parse(data);
          } catch (e) {
            // ignore parse error
          }
          console.log(`✅ Email sent to ${to}:`, result.data?.message_id || res.statusCode);
          resolve({ 
            success: true, 
            messageId: result.data?.message_id 
          });
        } else {
          console.error(`❌ ZeptoMail error ${res.statusCode}:`, data);
          resolve({ 
            success: false, 
            error: `HTTP ${res.statusCode}: ${data}` 
          });
        }
      });
    });

    req.on('error', (error) => {
      console.error('❌ Request error:', error);
      resolve({ success: false, error: error.message });
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Send email using a specific agent
 */
async function sendEmailWithAgent(agent, to, subject, htmlBody, textBody = '', recipientName = '') {
  const fromEmail = AGENT_FROM_EMAILS[agent] || DEFAULT_FROM_EMAIL;
  return sendEmail(to, subject, htmlBody, textBody, fromEmail, recipientName);
}

/**
 * Send bulk emails
 */
async function sendBulkEmails(emails, agent = 'bulk') {
  const results = [];
  const fromEmail = AGENT_FROM_EMAILS[agent] || DEFAULT_FROM_EMAIL;

  for (const email of emails) {
    const result = await sendEmail(
      email.to,
      email.subject,
      email.htmlBody,
      email.textBody || '',
      fromEmail,
      email.recipientName || ''
    );
    
    results.push({
      to: email.to,
      success: result.success,
      error: result.error,
      messageId: result.messageId,
    });
    
    // Small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return results;
}

/**
 * Template email (kept for compatibility)
 */
async function sendTemplateEmail(to, templateName, templateData, agent = 'notifications') {
  console.warn('sendTemplateEmail is deprecated. Use sendEmail directly with htmlBody.');
  throw new Error('sendTemplateEmail is deprecated. Use sendEmail directly with htmlBody.');
}

module.exports = {
  sendEmail,
  sendEmailWithAgent,
  sendBulkEmails,
  sendTemplateEmail,
  DEFAULT_FROM_EMAIL,
  AGENT_FROM_EMAILS,
};