/**
 * Staff Flow Offboarding Processor Lambda Function
 * 
 * This Lambda function processes offboarding events from SQS.
 * It handles:
 * - Sending exit interview emails via ZeptoMail
 * - Calculating final pay
 * - Revoking Cognito access (handled in server actions)
 * - Sending offboarding notifications
 * 
 * Triggered by: SQS Queue (staffflow-offboarding-queue)
 * 
 * Layer: staffflow-dependencies (arn:aws:lambda:us-east-1:320915182958:layer:staffflow-dependencies:2)
 * Dependencies: @neondatabase/serverless
 */

import https from 'https';
import { NeonQueryFunction } from '@neondatabase/serverless';

// Environment variables
const DATABASE_URL = process.env.DATABASE_URL;
const ZEPTOMAIL_API_KEY = process.env.ZEPTOMAIL_NOTIFICATIONS_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'notifications@stafflow.bz';
const APP_URL = process.env.APP_URL || 'https://stafflow.bz';

// ZeptoMail API endpoint
const ZEPTOMAIL_API_URL = 'https://api.zeptomail.com/v1.1/email';

// Initialize database
const sql = new NeonQueryFunction(DATABASE_URL);

/**
 * Send email via ZeptoMail API
 */
async function sendEmailViaZeptoMail(to, subject, htmlBody, textBody, name = '') {
  return new Promise((resolve) => {
    const payload = {
      from: { address: FROM_EMAIL },
      to: [{ email_address: { address: to, name: name || undefined } }],
      subject: subject,
      htmlbody: htmlBody,
      textbody: textBody,
    };
    
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
          console.log(`✅ ZeptoMail success: ${res.statusCode}`);
          resolve({ success: true });
        } else {
          console.error(`❌ ZeptoMail error ${res.statusCode}:`, data);
          resolve({ success: false, error: data });
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
 * Send exit interview email to employee
 */
async function sendExitInterviewEmail(employeeEmail, firstName, lastName, terminationDate) {
  const displayName = `${firstName} ${lastName}`.trim();
  
  const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f5f5f5; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .card { background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #4F46E5, #7C3AED); padding: 30px; text-align: center; }
    .header h1 { color: white; margin: 0; font-size: 28px; }
    .content { padding: 30px; }
    .info-box { background: #f9fafb; border-left: 4px solid #4F46E5; padding: 15px; margin: 20px 0; }
    .button { display: inline-block; background: linear-gradient(135deg, #4F46E5, #7C3AED); color: white; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: 500; margin: 20px 0; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; border-top: 1px solid #e5e7eb; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="header">
        <h1>Exit Interview Request</h1>
      </div>
      <div class="content">
        <p>Dear <strong>${displayName}</strong>,</p>
        
        <p>We would like to invite you to participate in an exit interview as part of your offboarding process. 
        Your feedback is valuable to us and will help us improve our workplace.</p>
        
        <div class="info-box">
          <p><strong>Termination Date:</strong> ${terminationDate}</p>
        </div>
        
        <p>Please click the link below to schedule your exit interview:</p>
        
        <div style="text-align: center;">
          <a href="${APP_URL}/exit-interview" class="button">Schedule Exit Interview</a>
        </div>
        
        <p>If you have any questions, please contact HR at hr@stafflow.bz.</p>
        
        <p>Thank you for your service and we wish you all the best in your future endeavors.</p>
        
        <p>Best regards,<br/>The HR Team</p>
      </div>
      <div class="footer">
        <p>This is an automated message from Staff Flow HRM</p>
        <p>© ${new Date().getFullYear()} Staff Flow. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>
  `;

  const emailText = `
Exit Interview Request

Dear ${displayName},

We would like to invite you to participate in an exit interview as part of your offboarding process.

Termination Date: ${terminationDate}

Please visit ${APP_URL}/exit-interview to schedule your exit interview.

If you have any questions, please contact HR at hr@stafflow.bz.

Best regards,
The HR Team
  `;

  const result = await sendEmailViaZeptoMail(employeeEmail, 'Exit Interview Request - Staff Flow HRM', emailHtml, emailText, displayName);
  
  if (result.success) {
    console.log(`✅ Exit interview email sent to ${employeeEmail}`);
  }
  return result;
}

/**
 * Send offboarding notification to HR
 */
async function sendHRNotification(employeeEmail, firstName, lastName, terminationDate, offboardingId) {
  const displayName = `${firstName} ${lastName}`.trim();
  const hrEmail = process.env.HR_EMAIL || 'hr@stafflow.bz';
  
  const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f5f5f5; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .card { background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #EC489A, #F97316); padding: 30px; text-align: center; }
    .header h1 { color: white; margin: 0; font-size: 28px; }
    .content { padding: 30px; }
    .details-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    .details-table td { padding: 12px; border-bottom: 1px solid #e5e7eb; }
    .details-table td:first-child { font-weight: 600; width: 40%; }
    .button { display: inline-block; background: linear-gradient(135deg, #EC489A, #F97316); color: white; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: 500; margin: 20px 0; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; border-top: 1px solid #e5e7eb; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="header">
        <h1>⚠️ New Offboarding Initiated</h1>
      </div>
      <div class="content">
        <p>A new offboarding process has been initiated.</p>
        
        <table class="details-table">
          <tr>
            <td>Employee</td>
            <td><strong>${displayName}</strong></td>
          </tr>
          <tr>
            <td>Email</td>
            <td>${employeeEmail}</td>
          </tr>
          <tr>
            <td>Termination Date</td>
            <td>${terminationDate}</td>
          </tr>
          <tr>
            <td>Offboarding ID</td>
            <td><code>${offboardingId}</code></td>
          </tr>
        </table>
        
        <div style="text-align: center;">
          <a href="${APP_URL}/dashboard/admin/offboarding/${offboardingId}" class="button">View Offboarding Details</a>
        </div>
      </div>
      <div class="footer">
        <p>This is an automated message from Staff Flow HRM</p>
        <p>© ${new Date().getFullYear()} Staff Flow. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>
  `;

  const emailText = `
New Offboarding Initiated

A new offboarding process has been initiated.

Employee: ${displayName}
Email: ${employeeEmail}
Termination Date: ${terminationDate}
Offboarding ID: ${offboardingId}

View details: ${APP_URL}/dashboard/admin/offboarding/${offboardingId}

This is an automated message from Staff Flow HRM.
  `;

  const result = await sendEmailViaZeptoMail(hrEmail, `Offboarding Initiated: ${displayName} - Staff Flow HRM`, emailHtml, emailText);
  
  if (result.success) {
    console.log(`✅ HR notification sent for offboarding ${offboardingId}`);
  }
  return result;
}

/**
 * Update offboarding status in database
 */
async function updateOffboardingStatus(offboardingId, field, value) {
  await sql`
    UPDATE offboarding_requests 
    SET ${sql(field)} = ${value}, updated_at = NOW() 
    WHERE id = ${offboardingId}
  `;
}

/**
 * Main Lambda handler
 */
export const handler = async (event) => {
  console.log('📧 Offboarding Processor Lambda started');
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    // Process each message from SQS
    for (const record of event.Records) {
      const message = JSON.parse(record.body);
      console.log('Processing message:', message);

      const { type, offboardingId, employeeId, email, firstName, lastName, terminationDate } = message;

      switch (type) {
        case 'OFFBOARDING_INITIATED':
          console.log(`Processing offboarding initiated for ${email}`);
          
          // Send HR notification
          try {
            await sendHRNotification(email, firstName, lastName, terminationDate, offboardingId);
          } catch (error) {
            console.error('Error sending HR notification:', error);
          }
          
          // Update status to in_progress
          await updateOffboardingStatus(offboardingId, 'status', 'in_progress');
          break;

        case 'EXIT_INTERVIEW':
          console.log(`Processing exit interview for ${email}`);
          
          // Send exit interview email
          try {
            await sendExitInterviewEmail(email, firstName, lastName, terminationDate);
            await updateOffboardingStatus(offboardingId, 'exit_interview_completed', true);
          } catch (error) {
            console.error('Error sending exit interview email:', error);
          }
          break;

        case 'CALCULATE_FINAL_PAY':
          console.log(`Processing final pay calculation for ${email}`);
          // Final pay calculation is handled in server actions
          break;

        case 'REVOKE_ACCESS':
          console.log(`Processing access revocation for ${email}`);
          // Access revocation is handled in server actions
          break;

        default:
          console.log(`Unknown message type: ${type}`);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Offboarding processed successfully' }),
    };
  } catch (error) {
    console.error('Error processing offboarding:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to process offboarding', message: error.message }),
    };
  }
};