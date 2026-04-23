/**
 * Staff Flow Leave Decision Handler Lambda Function
 * 
 * This Lambda function handles:
 * - Approving or rejecting leave requests
 * - Updating leave balances when approved
 * - Sending confirmation emails to employees
 * 
 * Layer: staffflow-dependencies (arn:aws:lambda:us-east-1:320915182958:layer:staffflow-dependencies:2)
 * Dependencies: @neondatabase/serverless
 */

const https = require('https');
const { neon } = require('@neondatabase/serverless');

// Environment variables
const DATABASE_URL = process.env.DATABASE_URL;
const FROM_EMAIL = process.env.FROM_EMAIL || process.env.NOTIFICATIONS_FROM_EMAIL || process.env.SES_FROM_EMAIL || 'notifications@stafflow.bz';
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
 * Get leave request with employee details
 */
async function getLeaveRequest(requestId) {
  const result = await sql`
    SELECT 
      lr.*,
      e.first_name,
      e.last_name,
      e.email as employee_email,
      u.email as employee_user_email
    FROM leave_requests lr
    JOIN employees e ON lr.employee_id = e.id
    LEFT JOIN users u ON e.id = u.employee_id
    WHERE lr.id = ${requestId}
  `;
  return result[0];
}

/**
 * Update leave request status
 */
async function updateLeaveRequestStatus(requestId, status, reviewedBy) {
  const result = await sql`
    UPDATE leave_requests 
    SET status = ${status},
        reviewed_by = ${reviewedBy},
        reviewed_at = NOW()
    WHERE id = ${requestId}
    RETURNING *
  `;
  return result[0];
}

/**
 * Update leave balance when request is approved
 */
async function updateLeaveBalance(employeeId, leaveType, year, daysUsed) {
  const result = await sql`
    UPDATE leave_balances
    SET used_days = used_days + ${daysUsed},
        balance = balance - ${daysUsed},
        updated_at = NOW()
    WHERE employee_id = ${employeeId}
      AND leave_type = ${leaveType}
      AND year = ${year}
    RETURNING *
  `;
  return result[0];
}

/**
 * Send approval confirmation email
 */
async function sendApprovalEmail(employee, leaveRequest) {
  const htmlContent = `
    <html>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #f0f0f0; padding: 20px;">
          <h2 style="color: #28a745;">Leave Request Approved ✅</h2>
          
          <div style="background: white; padding: 20px; border-radius: 5px;">
            <p>Dear ${employee.first_name} ${employee.last_name},</p>
            
            <p>Your leave request has been <strong>approved</strong>!</p>
            
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>Leave Type</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;">${leaveRequest.leave_type}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>Start Date</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;">${leaveRequest.start_date}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>End Date</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;">${leaveRequest.end_date}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>Total Days</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;">${leaveRequest.total_days}</td>
              </tr>
            </table>
            
            <p style="margin-top: 20px;">Your leave balance will be updated accordingly.</p>
          </div>
          
          <p style="color: #666; font-size: 12px; margin-top: 20px;">
            If you have any questions, please contact HR.
          </p>
        </div>
      </body>
    </html>
  `;

  try {
    await sendEmailViaZeptoMail(
      employee.email || employee.employee_email || employee.employee_user_email,
      `Leave Request Approved - ${leaveRequest.start_date} to ${leaveRequest.end_date}`,
      htmlContent
    );
    return true;
  } catch (error) {
    console.error('Failed to send approval email:', error);
    return false;
  }
}

/**
 * Send rejection email
 */
async function sendRejectionEmail(employee, leaveRequest, reason) {
  const htmlContent = `
    <html>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #f0f0f0; padding: 20px;">
          <h2 style="color: #dc3545;">Leave Request Update</h2>
          
          <div style="background: white; padding: 20px; border-radius: 5px;">
            <p>Dear ${employee.first_name} ${employee.last_name},</p>
            
            <p>Your leave request has been <strong>not approved</strong>.</p>
            
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>Leave Type</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;">${leaveRequest.leave_type}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>Start Date</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;">${leaveRequest.start_date}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>End Date</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;">${leaveRequest.end_date}</td>
              </tr>
              ${reason ? `
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>Reason</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;">${reason}</td>
              </tr>
              ` : ''}
            </table>
            
            <p style="margin-top: 20px;">Please contact your manager or HR for more information.</p>
          </div>
        </div>
      </body>
    </html>
  `;

  try {
    await sendEmailViaZeptoMail(
      employee.email || employee.employee_email || employee.employee_user_email,
      `Leave Request Status Update - ${leaveRequest.start_date} to ${leaveRequest.end_date}`,
      htmlContent
    );
    return true;
  } catch (error) {
    console.error('Failed to send rejection email:', error);
    return false;
  }
}

/**
 * Main Lambda handler
 */
exports.handler = async (event) => {
  console.log('Leave Decision Handler Lambda invoked');

  try {
    // Parse event body
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event;
    const { requestId, decision, reviewedBy, reason } = body;

    // Validate required fields
    if (!requestId || !decision) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          success: false, 
          error: 'Missing required fields: requestId, decision' 
        })
      };
    }

    // Validate decision value
    if (!['approved', 'rejected'].includes(decision)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          success: false, 
          error: 'Invalid decision. Must be "approved" or "rejected"' 
        })
      };
    }

    // Get leave request details
    const leaveRequest = await getLeaveRequest(requestId);
    if (!leaveRequest) {
      return {
        statusCode: 404,
        body: JSON.stringify({ 
          success: false, 
          error: 'Leave request not found' 
        })
      };
    }

    // Check if request is already processed
    if (leaveRequest.status !== 'pending') {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          success: false, 
          error: `Leave request already ${leaveRequest.status}` 
        })
      };
    }

    // Update leave request status
    const newStatus = decision === 'approved' ? 'approved' : 'rejected';
    await updateLeaveRequestStatus(requestId, newStatus, reviewedBy);

    // If approved, update leave balance
    if (decision === 'approved') {
      const currentYear = new Date().getFullYear();
      await updateLeaveBalance(
        leaveRequest.employee_id,
        leaveRequest.leave_type,
        currentYear,
        parseFloat(leaveRequest.total_days)
      );
    }

    // Send email notification to employee
    const employee = {
      first_name: leaveRequest.first_name,
      last_name: leaveRequest.last_name,
      email: leaveRequest.employee_email
    };

    if (decision === 'approved') {
      await sendApprovalEmail(employee, leaveRequest);
    } else {
      await sendRejectionEmail(employee, leaveRequest, reason);
    }

    console.log(`Leave request ${requestId} ${decision}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: `Leave request ${decision} successfully`,
        requestId,
        status: newStatus
      })
    };

  } catch (error) {
    console.error('Error processing leave decision:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        success: false, 
        error: error.message 
      })
    };
  }
};
