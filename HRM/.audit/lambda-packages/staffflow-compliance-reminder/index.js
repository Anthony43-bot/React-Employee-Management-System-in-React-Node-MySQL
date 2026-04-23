/**
 * Compliance Reminder Notifier Lambda Function
 * 
 * Sends email reminders for upcoming compliance deadlines
 * Triggered via CloudWatch Events (daily)
 */

const { getDbConnection, executeWithRetry } = require('./db');
const { sendEmail } = require('./email');

// Compliance deadline thresholds (days before expiry)
const REMINDER_THRESHOLDS = {
  workPermit: [90, 60, 30, 14, 7],  // Days before expiry
  ssbPayment: [14, 7, 3],              // Days before due date
  payeFiling: [14, 7, 3]               // Days before due date
};

/**
 * Fetch work permits expiring soon
 */
async function fetchExpiringWorkPermits(sql, daysThreshold) {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + daysThreshold);
  
  return executeWithRetry(
    `SELECT 
      e.id as employee_id,
      e.first_name,
      e.last_name,
      e.email as employee_email,
      e.work_permit_number,
      e.work_permit_expiry,
      e.nationality,
      o.id as organization_id,
      o.name as organization_name,
      u.email as hr_email
    FROM employees e
    JOIN organizations o ON o.id = e.organization_id
    LEFT JOIN users u ON u.organization_id = o.id AND u.role IN ('admin', 'hr')
    WHERE e.employment_status = 'active'
      AND e.work_permit_expiry IS NOT NULL
      AND e.work_permit_expiry <= $1
      AND e.work_permit_expiry >= $2
    GROUP BY e.id, o.id, u.email`,
    [futureDate.toISOString().split('T')[0], new Date().toISOString().split('T')[0]]
  );
}

/**
 * Get all HR admin emails for an organization
 */
async function getHRAdminEmails(sql, organizationId) {
  const result = await executeWithRetry(
    `SELECT email FROM users 
     WHERE organization_id = $1 
       AND role IN ('admin', 'hr')
       AND is_active = true`,
    [organizationId]
  );
  
  return result.map(r => r.email);
}

/**
 * Fetch organizations with SSB due dates
 */
async function fetchOrganizationsWithSSBDue(sql, daysThreshold) {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + daysThreshold);
  
  // Check compliance settings for SSB payment dates
  return executeWithRetry(
    `SELECT 
      o.id as organization_id,
      o.name as organization_name,
      o.ssb_employer_number,
      cs.value->>'nextDueDate' as ssb_due_date,
      u.email as hr_email
    FROM organizations o
    LEFT JOIN compliance_settings cs ON cs.key = 'ssb_payment_schedule' 
      AND cs.value->>'organizationId' = o.id::text
    LEFT JOIN users u ON u.organization_id = o.id AND u.role = 'admin'
    WHERE cs.value->>'nextDueDate' IS NOT NULL
      AND cs.value->>'nextDueDate' <= $1
      AND cs.value->>'nextDueDate' >= $2`,
    [futureDate.toISOString().split('T')[0], new Date().toISOString().split('T')[0]]
  );
}

/**
 * Fetch organizations with PAYE filing deadlines
 */
async function fetchOrganizationsWithPAYEDue(sql, daysThreshold) {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + daysThreshold);
  
  return executeWithRetry(
    `SELECT 
      o.id as organization_id,
      o.name as organization_name,
      o.tin,
      cs.value->>'nextDueDate' as paye_due_date,
      u.email as hr_email
    FROM organizations o
    LEFT JOIN compliance_settings cs ON cs.key = 'paye_filing_schedule'
      AND cs.value->>'organizationId' = o.id::text
    LEFT JOIN users u ON u.organization_id = o.id AND u.role = 'admin'
    WHERE cs.value->>'nextDueDate' IS NOT NULL
      AND cs.value->>'nextDueDate' <= $1
      AND cs.value->>'nextDueDate' >= $2`,
    [futureDate.toISOString().split('T')[0], new Date().toISOString().split('T')[0]]
  );
}

/**
 * Log sent reminder
 */
async function logReminder(sql, type, entityId, organizationId, recipientEmail, daysUntil) {
  return executeWithRetry(
    `INSERT INTO compliance_reminders (
      reminder_type,
      entity_id,
      organization_id,
      recipient_email,
      days_until_deadline,
      sent_at
    ) VALUES ($1, $2, $3, $4, $5, NOW())`,
    [type, entityId, organizationId, recipientEmail, daysUntil]
  );
}

/**
 * Check if reminder was already sent recently
 */
async function wasReminderSent(sql, type, entityId, daysUntil) {
  const result = await executeWithRetry(
    `SELECT id FROM compliance_reminders 
     WHERE reminder_type = $1 
       AND entity_id = $2 
       AND days_until_deadline = $3
       AND sent_at > NOW() - INTERVAL '24 hours'`,
    [type, entityId, daysUntil]
  );
  
  return result.length > 0;
}

/**
 * Send work permit reminder
 */
async function sendWorkPermitReminder(sql, employee, daysUntil) {
  const daysText = daysUntil === 0 ? 'today' : `in ${daysUntil} days`;
  
  const subject = `Work Permit Renewal Reminder - ${employee.first_name} ${employee.last_name}`;
  const body = `
    <h2>Work Permit Compliance Reminder</h2>
    <p>Dear HR Admin,</p>
    <p>This is a reminder that a work permit is expiring ${daysText}.</p>
    <h3>Employee Details:</h3>
    <ul>
      <li><strong>Name:</strong> ${employee.first_name} ${employee.last_name}</li>
      <li><strong>Work Permit Number:</strong> ${employee.work_permit_number}</li>
      <li><strong>Expiry Date:</strong> ${employee.work_permit_expiry}</li>
      <li><strong>Nationality:</strong> ${employee.nationality}</li>
      <li><strong>Organization:</strong> ${employee.organization_name}</li>
    </ul>
    <p>Please take action to renew the work permit to maintain compliance.</p>
    <p>Best regards,<br/>Staff Flow HR System</p>
  `;
  
  const recipient = employee.hr_email || employee.employee_email;
  
  // Check if reminder was already sent
  const alreadySent = await wasReminderSent(sql, 'work_permit', employee.employee_id, daysUntil);
  if (alreadySent) {
    console.log(`Work permit reminder already sent for employee ${employee.employee_id} (${daysUntil} days)`);
    return { skipped: true };
  }
  
  try {
    const result = await sendEmail(recipient, subject, body, true);
    await logReminder(sql, 'work_permit', employee.employee_id, employee.organization_id, recipient, daysUntil);
    return { success: true, recipient };
  } catch (error) {
    console.error(`Failed to send work permit reminder:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Send SSB payment reminder
 */
async function sendSSBReminder(sql, org, daysUntil) {
  const subject = `SSB Payment Reminder - ${org.organization_name}`;
  const body = `
    <h2>Social Security Board (SSB) Payment Reminder</h2>
    <p>Dear HR Admin,</p>
    <p>This is a reminder that SSB payment is due in ${daysUntil} days.</p>
    <h3>Organization Details:</h3>
    <ul>
      <li><strong>Organization:</strong> ${org.organization_name}</li>
      <li><strong>SSB Employer Number:</strong> ${org.ssb_employer_number}</li>
      <li><strong>Due Date:</strong> ${org.ssb_due_date}</li>
    </ul>
    <p>Please ensure timely payment to avoid penalties.</p>
    <p>Best regards,<br/>Staff Flow HR System</p>
  `;
  
  if (!org.hr_email) {
    console.log(`No HR email found for organization ${org.organization_id}`);
    return { skipped: true };
  }
  
  const alreadySent = await wasReminderSent(sql, 'ssb_payment', org.organization_id, daysUntil);
  if (alreadySent) {
    console.log(`SSB reminder already sent for org ${org.organization_id} (${daysUntil} days)`);
    return { skipped: true };
  }
  
  try {
    const result = await sendEmail(org.hr_email, subject, body, true);
    await logReminder(sql, 'ssb_payment', org.organization_id, org.organization_id, org.hr_email, daysUntil);
    return { success: true, recipient: org.hr_email };
  } catch (error) {
    console.error(`Failed to send SSB reminder:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Send PAYE filing reminder
 */
async function sendPAYEReminder(sql, org, daysUntil) {
  const subject = `PAYE Filing Reminder - ${org.organization_name}`;
  const body = `
    <h2>PAYE Filing Reminder</h2>
    <p>Dear HR Admin,</p>
    <p>This is a reminder that PAYE filing is due in ${daysUntil} days.</p>
    <h3>Organization Details:</h3>
    <ul>
      <li><strong>Organization:</strong> ${org.organization_name}</li>
      <li><strong>TIN:</strong> ${org.tin}</li>
      <li><strong>Due Date:</strong> ${org.paye_due_date}</li>
    </ul>
    <p>Please ensure timely filing to avoid penalties.</p>
    <p>Best regards,<br/>Staff Flow HR System</p>
  `;
  
  if (!org.hr_email) {
    console.log(`No HR email found for organization ${org.organization_id}`);
    return { skipped: true };
  }
  
  const alreadySent = await wasReminderSent(sql, 'paye_filing', org.organization_id, daysUntil);
  if (alreadySent) {
    console.log(`PAYE reminder already sent for org ${org.organization_id} (${daysUntil} days)`);
    return { skipped: true };
  }
  
  try {
    const result = await sendEmail(org.hr_email, subject, body, true);
    await logReminder(sql, 'paye_filing', org.organization_id, org.organization_id, org.hr_email, daysUntil);
    return { success: true, recipient: org.hr_email };
  } catch (error) {
    console.error(`Failed to send PAYE reminder:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Main Lambda handler
 */
exports.handler = async (event) => {
  console.log('Compliance Reminder Notifier started:', JSON.stringify(event));
  
  const sql = getDbConnection();
  
  // Create compliance_reminders table if it doesn't exist
  try {
    await executeWithRetry(
      `CREATE TABLE IF NOT EXISTS compliance_reminders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reminder_type VARCHAR(50) NOT NULL,
        entity_id UUID NOT NULL,
        organization_id UUID NOT NULL,
        recipient_email VARCHAR(255) NOT NULL,
        days_until_deadline INTEGER,
        sent_at TIMESTAMP DEFAULT NOW()
      )`,
      []
    );
  } catch (e) {
    // Table might already exist
    console.log('Compliance reminders table check:', e.message);
  }
  
  try {
    const results = {
      workPermits: [],
      ssbPayments: [],
      payeFilings: [],
      totalSent: 0,
      totalSkipped: 0,
      totalFailed: 0
    };
    
    // Process work permit reminders for each threshold
    for (const days of REMINDER_THRESHOLDS.workPermit) {
      const expiringPermits = await fetchExpiringWorkPermits(sql, days);
      
      for (const employee of expiringPermits) {
        const result = await sendWorkPermitReminder(sql, employee, days);
        if (result.success) results.totalSent++;
        else if (result.skipped) results.totalSkipped++;
        else results.totalFailed++;
        
        results.workPermits.push({
          employee: `${employee.first_name} ${employee.last_name}`,
          daysUntil: days,
          ...result
        });
      }
    }
    
    // Process SSB payment reminders
    for (const days of REMINDER_THRESHOLDS.ssbPayment) {
      const orgsWithSSBDue = await fetchOrganizationsWithSSBDue(sql, days);
      
      for (const org of orgsWithSSBDue) {
        const result = await sendSSBReminder(sql, org, days);
        if (result.success) results.totalSent++;
        else if (result.skipped) results.totalSkipped++;
        else results.totalFailed++;
        
        results.ssbPayments.push({
          organization: org.organization_name,
          daysUntil: days,
          ...result
        });
      }
    }
    
    // Process PAYE filing reminders
    for (const days of REMINDER_THRESHOLDS.payeFiling) {
      const orgsWithPAYEDue = await fetchOrganizationsWithPAYEDue(sql, days);
      
      for (const org of orgsWithPAYEDue) {
        const result = await sendPAYEReminder(sql, org, days);
        if (result.success) results.totalSent++;
        else if (result.skipped) results.totalSkipped++;
        else results.totalFailed++;
        
        results.payeFilings.push({
          organization: org.organization_name,
          daysUntil: days,
          ...result
        });
      }
    }
    
    const response = {
      status: 'completed',
      timestamp: new Date().toISOString(),
      ...results
    };
    
    console.log('Compliance Reminder Notifier completed:', response);
    
    return response;
    
  } catch (error) {
    console.error('Compliance Reminder Notifier failed:', error);
    throw error;
  }
};
