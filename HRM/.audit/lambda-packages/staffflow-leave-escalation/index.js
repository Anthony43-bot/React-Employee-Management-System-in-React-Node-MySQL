/**
 * Staff Flow Leave Escalation Handler Lambda Function
 *
 * This Lambda function is triggered by EventBridge daily to:
 * - Check for pending leave requests older than threshold days
 * - Send reminder emails to managers
 * - Escalate to HR if still pending
 */

const https = require('https');
const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL;
const FROM_EMAIL = process.env.FROM_EMAIL || process.env.NOTIFICATIONS_FROM_EMAIL || process.env.SES_FROM_EMAIL || 'notifications@stafflow.bz';
const APP_URL = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://stafflow.bz').replace(/\/$/, '');
const PENDING_THRESHOLD_DAYS = parseInt(process.env.PENDING_THRESHOLD_DAYS || '3', 10);
const ZEPTOMAIL_API_KEY = process.env.ZEPTOMAIL_API_KEY || process.env.ZEPTO_NOTIFICATIONS_API_KEY;

const sql = neon(DATABASE_URL);

function normalizeZeptoAuth(apiKey) {
  if (!apiKey) {
    throw new Error('Missing ZeptoMail API key');
  }
  return apiKey.startsWith('Zoho-enczapikey ') ? apiKey : `Zoho-enczapikey ${apiKey}`;
}

async function sendEmailViaZeptoMail(to, subject, htmlContent) {
  const payload = JSON.stringify({
    from: { address: FROM_EMAIL, name: 'Staff Flow HRM' },
    to: [{ email_address: { address: to } }],
    subject,
    htmlbody: htmlContent,
  });

  const options = {
    hostname: 'api.zeptomail.com',
    port: 443,
    path: '/v1.1/email',
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: normalizeZeptoAuth(ZEPTOMAIL_API_KEY),
      'Content-Length': Buffer.byteLength(payload),
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(true);
          return;
        }
        reject(new Error(`ZeptoMail API error: ${res.statusCode} - ${responseData}`));
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function getStalePendingRequests() {
  const thresholdDate = new Date();
  thresholdDate.setDate(thresholdDate.getDate() - PENDING_THRESHOLD_DAYS);

  return sql`
    SELECT
      lr.*,
      e.first_name as employee_first_name,
      e.last_name as employee_last_name,
      e.email as employee_email,
      m.first_name as manager_first_name,
      m.last_name as manager_last_name,
      m.email as manager_email,
      mu.id as manager_user_id
    FROM leave_requests lr
    JOIN employees e ON lr.employee_id = e.id
    LEFT JOIN employees m ON e.manager_id = m.id
    LEFT JOIN users mu ON m.id = mu.employee_id
    WHERE lr.status = 'pending'
      AND lr.created_at < ${thresholdDate.toISOString()}
    ORDER BY lr.created_at ASC
  `;
}

async function getHRManagers() {
  return sql`
    SELECT DISTINCT
      e.first_name,
      e.last_name,
      e.email,
      u.id as user_id
    FROM users u
    JOIN employees e ON u.employee_id = e.id
    WHERE u.role = 'hr_manager'
      AND u.is_active = true
  `;
}

async function sendReminderEmail(manager, leaveRequest, daysPending) {
  if (!manager?.email) {
    console.log('No manager email, skipping reminder');
    return false;
  }

  const htmlContent = `
    <html>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #fff3cd; padding: 20px;">
          <h2 style="color: #856404;">Leave Request Reminder</h2>
          <div style="background: white; padding: 20px; border-radius: 5px;">
            <p>Dear ${manager.first_name} ${manager.last_name},</p>
            <p>This is a reminder that the following leave request has been pending for <strong>${daysPending} days</strong>:</p>
            <table style="width: 100%; border-collapse: collapse;">
              <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Employee</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${leaveRequest.employee_first_name} ${leaveRequest.employee_last_name}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Leave Type</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${leaveRequest.leave_type}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Start Date</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${leaveRequest.start_date}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>End Date</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${leaveRequest.end_date}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Days Pending</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${daysPending}</td></tr>
            </table>
            <div style="margin-top: 20px;">
              <a href="${APP_URL}/dashboard/leave/review/${leaveRequest.id}" style="background: #0066cc; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Review Now</a>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;

  try {
    await sendEmailViaZeptoMail(
      manager.email,
      `Reminder: Pending Leave Request from ${leaveRequest.employee_first_name} ${leaveRequest.employee_last_name}`,
      htmlContent
    );
    console.log(`Reminder sent to manager ${manager.email}`);
    return true;
  } catch (error) {
    console.error('Failed to send reminder:', error);
    return false;
  }
}

async function sendEscalationEmail(hrManager, staleRequests) {
  if (!hrManager?.email) {
    return false;
  }

  const requestList = staleRequests.map((request) =>
    `<li>${request.employee_first_name} ${request.employee_last_name} - ${request.leave_type} (${request.start_date} to ${request.end_date}) - Pending ${Math.floor((Date.now() - new Date(request.created_at).getTime()) / (1000 * 60 * 60 * 24))} days</li>`
  ).join('');

  const htmlContent = `
    <html>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #dc3545; padding: 20px;">
          <h2 style="color: white;">Escalation: Pending Leave Requests</h2>
          <div style="background: white; padding: 20px; border-radius: 5px;">
            <p>Dear ${hrManager.first_name} ${hrManager.last_name},</p>
            <p>The following leave requests have been pending for more than ${PENDING_THRESHOLD_DAYS} days and require attention:</p>
            <ul>${requestList}</ul>
            <div style="margin-top: 20px;">
              <a href="${APP_URL}/dashboard/leave" style="background: #dc3545; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View Pending Requests</a>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;

  try {
    await sendEmailViaZeptoMail(
      hrManager.email,
      `Escalation: ${staleRequests.length} Leave Requests Need Immediate Attention`,
      htmlContent
    );
    console.log(`Escalation sent to HR ${hrManager.email}`);
    return true;
  } catch (error) {
    console.error('Failed to send escalation:', error);
    return false;
  }
}

exports.handler = async () => {
  console.log('Leave Escalation Handler Lambda invoked');
  console.log('Pending threshold days:', PENDING_THRESHOLD_DAYS);

  try {
    const staleRequests = await getStalePendingRequests();
    console.log(`Found ${staleRequests.length} stale pending requests`);

    if (staleRequests.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No stale pending requests found',
          processed: 0,
        }),
      };
    }

    const requestsByManager = {};
    for (const request of staleRequests) {
      const managerId = request.manager_user_id || 'hr';
      if (!requestsByManager[managerId]) {
        requestsByManager[managerId] = {
          manager: {
            email: request.manager_email,
            first_name: request.manager_first_name,
            last_name: request.manager_last_name,
          },
          requests: [],
        };
      }
      requestsByManager[managerId].requests.push(request);
    }

    let remindersSent = 0;
    for (const data of Object.values(requestsByManager)) {
      if (data.manager.email) {
        for (const request of data.requests) {
          const daysPending = Math.floor((Date.now() - new Date(request.created_at).getTime()) / (1000 * 60 * 60 * 24));
          await sendReminderEmail(data.manager, request, daysPending);
          remindersSent += 1;
        }
      }
    }

    const hrManagers = await getHRManagers();
    let escalationsSent = 0;
    for (const hrManager of hrManagers) {
      await sendEscalationEmail(hrManager, staleRequests);
      escalationsSent += 1;
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Escalation processing completed',
        staleRequestsCount: staleRequests.length,
        remindersSent,
        escalationsSent,
      }),
    };
  } catch (error) {
    console.error('Error in escalation handler:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
