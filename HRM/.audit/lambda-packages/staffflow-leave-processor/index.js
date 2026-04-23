/**
 * Staff Flow Leave Request Processor Lambda Function
 * 
 * This Lambda function is triggered by SQS and processes leave requests.
 * It handles:
 * - Validating leave request and checking balance
 * - Creating leave request record in database
 * - Sending notification to manager via ZeptoMail
 * 
 * Layer: staffflow-dependencies (arn:aws:lambda:us-east-1:320915182958:layer:staffflow-dependencies:2)
 * Dependencies: @neondatabase/serverless
 */

const https = require('https');
const { neon } = require('@neondatabase/serverless');

// Environment variables
const DATABASE_URL = process.env.DATABASE_URL;
const FROM_EMAIL = process.env.FROM_EMAIL || process.env.NOTIFICATIONS_FROM_EMAIL || process.env.SES_FROM_EMAIL || 'notifications@stafflow.bz';
const APP_URL = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://stafflow.bz').replace(/\/$/, '');
const ZEPTOMAIL_API_KEY = process.env.ZEPTOMAIL_API_KEY || process.env.ZEPTO_NOTIFICATIONS_API_KEY;

// Initialize clients
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

/**
 * Get employee with manager info
 */
async function getEmployeeWithManager(employeeId) {
  const result = await sql`
    SELECT 
      e.*,
      u.email as user_email,
      u.id as user_id,
      m.first_name as manager_first_name,
      m.last_name as manager_last_name,
      m.email as manager_email,
      mu.id as manager_user_id
    FROM employees e
    LEFT JOIN users u ON e.id = u.employee_id
    LEFT JOIN employees m ON e.manager_id = m.id
    LEFT JOIN users mu ON m.id = mu.employee_id
    WHERE e.id = ${employeeId}
  `;
  return result[0];
}

/**
 * Get leave balance for employee
 */
async function getLeaveBalance(employeeId, leaveType, year) {
  const result = await sql`
    SELECT * FROM leave_balances
    WHERE employee_id = ${employeeId}
      AND leave_type = ${leaveType}
      AND year = ${year}
  `;
  return result[0];
}

/**
 * Calculate leave days between dates
 */
function calculateLeaveDays(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  return diffDays;
}

/**
 * Create leave request record
 */
async function createLeaveRequest(data) {
  const result = await sql`
    INSERT INTO leave_requests (
      organization_id,
      employee_id,
      leave_type,
      start_date,
      end_date,
      total_days,
      reason,
      status,
      created_at
    )
    VALUES (
      ${data.organizationId},
      ${data.employeeId},
      ${data.leaveType},
      ${data.startDate},
      ${data.endDate},
      ${data.totalDays},
      ${data.reason},
      'pending',
      NOW()
    )
    RETURNING id
  `;
  return result[0];
}

/**
 * Find manager for employee (walk up the hierarchy)
 */
async function findManager(employeeId) {
  // First try direct manager
  const directManager = await sql`
    SELECT 
      m.id as employee_id,
      m.first_name,
      m.last_name,
      m.email,
      u.id as user_id
    FROM employees m
    LEFT JOIN users u ON m.id = u.employee_id
    JOIN employees e ON e.manager_id = m.id
    WHERE e.id = ${employeeId}
    LIMIT 1
  `;

  if (directManager.length > 0) {
    return directManager[0];
  }

  // If no direct manager, find any HR manager
  const hrManager = await sql`
    SELECT 
      e.id as employee_id,
      e.first_name,
      e.last_name,
      e.email,
      u.id as user_id
    FROM employees e
    LEFT JOIN users u ON e.id = u.employee_id
    JOIN users u2 ON u2.employee_id = e.id AND u2.role = 'hr_manager'
    WHERE e.employment_status = 'active'
    LIMIT 1
  `;

  return hrManager[0] || null;
}

/**
 * Send manager notification email
 */
async function sendManagerNotificationEmail(manager, employee, leaveRequest) {
  if (!manager?.email) {
    console.log('No manager email found, skipping notification');
    return false;
  }

  const htmlContent = `
    <html>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #f0f0f0; padding: 20px;">
          <h2 style="color: #333;">New Leave Request</h2>
          
          <div style="background: white; padding: 20px; border-radius: 5px;">
            <p><strong>Employee:</strong> ${employee.first_name} ${employee.last_name}</p>
            <p><strong>Leave Type:</strong> ${leaveRequest.leave_type}</p>
            <p><strong>Start Date:</strong> ${leaveRequest.start_date}</p>
            <p><strong>End Date:</strong> ${leaveRequest.end_date}</p>
            <p><strong>Total Days:</strong> ${leaveRequest.total_days}</p>
            ${leaveRequest.reason ? `<p><strong>Reason:</strong> ${leaveRequest.reason}</p>` : ''}
            
            <div style="margin-top: 20px;">
              <a href="${APP_URL}/dashboard/leave/review/${leaveRequest.id}" 
                 style="background: #0066cc; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
                Review Request
              </a>
            </div>
          </div>
          
          <p style="color: #666; font-size: 12px; margin-top: 20px;">
            Please review and approve or reject this leave request.
          </p>
        </div>
      </body>
    </html>
  `;

  try {
    await sendEmailViaZeptoMail(
      manager.email,
      `Leave Request from ${employee.first_name} ${employee.last_name} - Requires Your Approval`,
      htmlContent
    );
    console.log(`Manager notification sent to ${manager.email}`);
    return true;
  } catch (error) {
    console.error('Failed to send manager notification:', error);
    return false;
  }
}

/**
 * Send employee rejection email (insufficient balance)
 */
async function sendInsufficientBalanceEmail(employee, leaveType, requestedDays, availableDays) {
  const htmlContent = `
    <html>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #f0f0f0; padding: 20px;">
          <h2 style="color: #cc0000;">Leave Request Cannot Be Processed</h2>
          
          <div style="background: white; padding: 20px; border-radius: 5px;">
            <p>Dear ${employee.first_name} ${employee.last_name},</p>
            
            <p>Your leave request for <strong>${leaveType}</strong> could not be submitted because:</p>
            
            <ul>
              <li>Requested days: ${requestedDays}</li>
              <li>Available days: ${availableDays}</li>
            </ul>
            
            <p>Please contact your manager or HR to discuss alternative options.</p>
          </div>
        </div>
      </body>
    </html>
  `;

  try {
    await sendEmailViaZeptoMail(
      employee.email || employee.user_email,
      'Leave Request Update - Insufficient Balance',
      htmlContent
    );
    return true;
  } catch (error) {
    console.error('Failed to send insufficient balance email:', error);
    return false;
  }
}

/**
 * Main SQS handler
 */
exports.handler = async (event) => {
  console.log('Leave Processor Lambda invoked with', event.Records?.length, 'messages');

  const results = {
    processed: 0,
    failed: 0,
    errors: []
  };

  for (const record of event.Records || []) {
    try {
      const messageBody = JSON.parse(record.body);
      const { 
        employeeId, 
        organizationId, 
        leaveType, 
        startDate, 
        endDate, 
        reason 
      } = messageBody;

      console.log('Processing leave request for employee:', employeeId);

      // Validate required fields
      if (!employeeId || !leaveType || !startDate || !endDate) {
        throw new Error('Missing required fields');
      }

      // Calculate total days
      const totalDays = calculateLeaveDays(startDate, endDate);

      // Get employee with manager info
      const employee = await getEmployeeWithManager(employeeId);
      if (!employee) {
        throw new Error(`Employee not found: ${employeeId}`);
      }

      // Check leave balance (skip for some leave types like unpaid leave)
      const leaveTypesNoBalance = ['unpaid', 'bereavement', 'jury_duty'];
      if (!leaveTypesNoBalance.includes(leaveType.toLowerCase())) {
        const currentYear = new Date().getFullYear();
        const balance = await getLeaveBalance(employeeId, leaveType, currentYear);
        
        if (balance) {
          const availableBalance = parseFloat(balance.balance) - parseFloat(balance.used_days);
          
          if (totalDays > availableBalance) {
            // Insufficient balance - notify employee and skip
            await sendInsufficientBalanceEmail(employee, leaveType, totalDays, availableBalance);
            results.failed++;
            results.errors.push({ 
              employeeId, 
              error: 'Insufficient leave balance',
              requestedDays: totalDays,
              availableDays: availableBalance
            });
            continue;
          }
        }
      }

      // Create leave request record
      const leaveRequest = await createLeaveRequest({
        organizationId: organizationId || employee.organization_id,
        employeeId,
        leaveType,
        startDate,
        endDate,
        totalDays,
        reason
      });

      // Find manager and send notification
      const manager = await findManager(employeeId);
      if (manager) {
        await sendManagerNotificationEmail(manager, employee, leaveRequest);
      }

      console.log(`Leave request ${leaveRequest.id} created and manager notified`);
      results.processed++;

    } catch (error) {
      console.error('Error processing leave request:', error);
      results.failed++;
      results.errors.push({ error: error.message });
    }
  }

  console.log('Leave processor results:', results);
  
  return {
    statusCode: 200,
    body: JSON.stringify(results)
  };
};
