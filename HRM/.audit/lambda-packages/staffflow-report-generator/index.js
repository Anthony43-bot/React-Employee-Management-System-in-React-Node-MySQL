const https = require('https');
const { neon } = require('@neondatabase/serverless');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const sql = neon(process.env.DATABASE_URL);
const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'staffflow-documents-optimyzebz';
const FROM_EMAIL = process.env.FROM_EMAIL || process.env.NOTIFICATIONS_FROM_EMAIL || process.env.SES_FROM_EMAIL || 'notifications@stafflow.bz';
const ZEPTOMAIL_API_KEY = process.env.ZEPTOMAIL_API_KEY || process.env.ZEPTO_NOTIFICATIONS_API_KEY;

function normalizeZeptoAuth(apiKey) {
  if (!apiKey) {
    throw new Error('Missing ZeptoMail API key');
  }
  return apiKey.startsWith('Zoho-enczapikey ') ? apiKey : `Zoho-enczapikey ${apiKey}`;
}

async function sendEmailViaZeptoMail(to, subject, textBody) {
  const payload = JSON.stringify({
    from: { address: FROM_EMAIL, name: 'Staff Flow HRM' },
    to: [{ email_address: { address: to } }],
    subject,
    textbody: textBody,
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
 * Staff Flow HRM Report Generator Lambda
 * Generates reports for HR administrators and employees
 */
exports.handler = async (event) => {
  console.log('Report Generator Lambda triggered:', JSON.stringify(event));
  
  const jobId = event.jobId;
  
  if (!jobId) {
    console.error('No jobId provided');
    return { statusCode: 400, body: 'Missing jobId' };
  }

  try {
    // Fetch job details
    const jobs = await sql`SELECT * FROM report_jobs WHERE id = ${jobId}`;
    
    if (jobs.length === 0) {
      console.error('Job not found:', jobId);
      return { statusCode: 404, body: 'Job not found' };
    }
    
    const job = jobs[0];
    const { report_type, parameters, organization_id, requested_by } = job;
    
    // Update job status to processing
    await sql`UPDATE report_jobs SET status = 'processing', updated_at = NOW() WHERE id = ${jobId}`;
    
    console.log(`Processing report: ${report_type} for organization: ${organization_id}`);
    
    let data;
    let fileContent;
    let fileExtension;
    
    // Generate report based on type
    switch (report_type) {
      case 'employee_directory':
        data = await generateEmployeeDirectory(organization_id);
        fileExtension = 'csv';
        fileContent = convertToCSV(data);
        break;
        
      case 'headcount':
        data = await generateHeadcountReport(organization_id, parameters);
        fileExtension = 'csv';
        fileContent = convertToCSV(data);
        break;
        
      case 'diversity':
        data = await generateDiversityReport(organization_id);
        fileExtension = 'csv';
        fileContent = convertToCSV(data);
        break;
        
      case 'training_certifications':
        data = await generateTrainingCertifications(organization_id, parameters);
        fileExtension = 'csv';
        fileContent = convertToCSV(data);
        break;
        
      case 'compliance_calendar':
        data = await generateComplianceCalendar(organization_id);
        fileExtension = 'csv';
        fileContent = convertToCSV(data);
        break;
        
      case 'absenteeism':
        data = await generateAbsenteeismReport(organization_id, parameters);
        fileExtension = 'csv';
        fileContent = convertToCSV(data);
        break;
        
      case 'overtime_report':
        data = await generateOvertimeReport(organization_id, parameters);
        fileExtension = 'csv';
        fileContent = convertToCSV(data);
        break;
        
      case 'payslip_history':
        data = await generatePayslipHistory(organization_id, parameters);
        fileExtension = 'csv';
        fileContent = convertToCSV(data);
        break;
        
      case 'cost_per_employee':
        data = await generateCostPerEmployee(organization_id, parameters);
        fileExtension = 'csv';
        fileContent = convertToCSV(data);
        break;
        
      case 'leave_summary':
        data = await generateLeaveSummary(organization_id, parameters);
        fileExtension = 'csv';
        fileContent = convertToCSV(data);
        break;
        
      case 'attendance':
        data = await generateAttendanceReport(organization_id, parameters);
        fileExtension = 'csv';
        fileContent = convertToCSV(data);
        break;
        
      case 'payroll_summary':
        data = await generatePayrollSummary(organization_id, parameters);
        fileExtension = 'csv';
        fileContent = convertToCSV(data);
        break;
        
      case 'turnover':
        data = await generateTurnoverReport(organization_id, parameters);
        fileExtension = 'csv';
        fileContent = convertToCSV(data);
        break;
        
      case 'compliance':
        data = await generateComplianceReport(organization_id);
        fileExtension = 'csv';
        fileContent = convertToCSV(data);
        break;
        
      case 'my_payslips':
        data = await generateMyPayslips(organization_id, requested_by);
        fileExtension = 'csv';
        fileContent = convertToCSV(data);
        break;
        
      case 'my_leave_summary':
        data = await generateMyLeaveSummary(organization_id, requested_by);
        fileExtension = 'csv';
        fileContent = convertToCSV(data);
        break;
        
      case 'my_attendance':
        data = await generateMyAttendance(organization_id, requested_by, parameters);
        fileExtension = 'csv';
        fileContent = convertToCSV(data);
        break;
        
      case 'my_profile':
        data = await generateMyProfile(organization_id, requested_by);
        fileExtension = 'csv';
        fileContent = convertToCSV(data);
        break;
        
      default:
        throw new Error(`Unknown report type: ${report_type}`);
    }
    
    // Upload to S3
    const key = `reports/${organization_id}/${jobId}.${fileExtension}`;
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: fileContent,
      ContentType: fileExtension === 'pdf' ? 'application/pdf' : 'text/csv',
    }));
    
    // Update job as completed
    await sql`
      UPDATE report_jobs
      SET status = 'completed', s3_key = ${key}, 
          file_size = ${Buffer.byteLength(fileContent, 'utf-8')},
          generated_at = NOW(), updated_at = NOW()
      WHERE id = ${jobId}
    `;
    
    // Send email notification if user email is available
    await sendNotification(organization_id, requested_by, report_type, key);
    
    console.log(`Report generated successfully: ${jobId}`);
    return { statusCode: 200, body: 'Report generated successfully' };
    
  } catch (error) {
    console.error('Error generating report:', error);
    
    // Update job as failed
    await sql`
      UPDATE report_jobs
      SET status = 'failed', error_message = ${error.message}, updated_at = NOW()
      WHERE id = ${jobId}
    `;
    
    return { statusCode: 500, body: `Error: ${error.message}` };
  }
};

// Report generation functions
async function generateEmployeeDirectory(organizationId) {
  const employees = await sql`
    SELECT 
      e.employee_number,
      e.first_name,
      e.last_name,
      e.email,
      e.phone,
      e.department_name,
      e.position_name,
      e.hire_date,
      e.employment_status,
      e.employment_type
    FROM employees e
    WHERE e.organization_id = ${organizationId}
    ORDER BY e.last_name, e.first_name
  `;
  return employees;
}

async function generateHeadcountReport(organizationId, parameters) {
  const { departmentId, location } = parameters || {};
  
  let query = sql`
    SELECT 
      department_name,
      employment_type,
      employment_status,
      COUNT(*) as employee_count
    FROM employees
    WHERE organization_id = ${organizationId}
  `;
  
  if (departmentId) {
    query = sql`${query} AND department_id = ${departmentId}`;
  }
  
  query = sql`${query} GROUP BY department_name, employment_type, employment_status ORDER BY department_name, employment_type`;
  
  return query;
}

async function generateDiversityReport(organizationId) {
  const genderStats = await sql`
    SELECT 
      gender,
      COUNT(*) as count,
      ROUND(COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER(), 0), 2) as percentage
    FROM employees
    WHERE organization_id = ${organizationId} AND gender IS NOT NULL
    GROUP BY gender
  `;
  
  const nationalityStats = await sql`
    SELECT 
      nationality,
      COUNT(*) as count,
      ROUND(COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER(), 0), 2) as percentage
    FROM employees
    WHERE organization_id = ${organizationId} AND nationality IS NOT NULL
    GROUP BY nationality
    ORDER BY count DESC
    LIMIT 10
  `;
  
  const ageStats = await sql`
    SELECT 
      CASE 
        WHEN EXTRACT(YEAR FROM AGE(CURRENT_DATE, TO_DATE(date_of_birth, 'YYYY-MM-DD'))) < 25 THEN 'Under 25'
        WHEN EXTRACT(YEAR FROM AGE(CURRENT_DATE, TO_DATE(date_of_birth, 'YYYY-MM-DD'))) BETWEEN 25 AND 34 THEN '25-34'
        WHEN EXTRACT(YEAR FROM AGE(CURRENT_DATE, TO_DATE(date_of_birth, 'YYYY-MM-DD'))) BETWEEN 35 AND 44 THEN '35-44'
        WHEN EXTRACT(YEAR FROM AGE(CURRENT_DATE, TO_DATE(date_of_birth, 'YYYY-MM-DD'))) BETWEEN 45 AND 54 THEN '45-54'
        ELSE '55+'
      END as age_group,
      COUNT(*) as count
    FROM employees
    WHERE organization_id = ${organizationId} AND date_of_birth IS NOT NULL
    GROUP BY age_group
    ORDER BY age_group
  `;
  
  return {
    byGender: genderStats,
    byNationality: nationalityStats,
    byAgeGroup: ageStats
  };
}

async function generateTrainingCertifications(organizationId, parameters) {
  const { status, expiringWithinDays } = parameters || {};
  
  let query = sql`
    SELECT 
      e.employee_number,
      e.first_name,
      e.last_name,
      e.department_name,
      tr.course_name,
      tr.provider,
      tr.completion_date,
      tr.certificate_number,
      tr.status,
      tr.hours_completed
    FROM training_records tr
    JOIN employees e ON e.id = tr.employee_id
    WHERE e.organization_id = ${organizationId}
  `;
  
  if (status) {
    query = sql`${query} AND tr.status = ${status}`;
  }
  
  if (expiringWithinDays) {
    query = sql`${query} AND tr.completion_date <= CURRENT_DATE + ${parseInt(expiringWithinDays)}`;
  }
  
  query = sql`${query} ORDER BY e.last_name, tr.completion_date DESC`;
  
  return query;
}

async function generateComplianceCalendar(organizationId) {
  const workPermits = await sql`
    SELECT 
      employee_number,
      first_name,
      last_name,
      work_permit_number,
      work_permit_expiry,
      TO_DATE(work_permit_expiry, 'YYYY-MM-DD') - CURRENT_DATE as days_remaining,
      'Work Permit' as event_type
    FROM employees
    WHERE organization_id = ${organizationId}
      AND work_permit_expiry IS NOT NULL
      AND employment_status = 'active'
      AND TO_DATE(work_permit_expiry, 'YYYY-MM-DD') - CURRENT_DATE <= 90
    ORDER BY work_permit_expiry
  `;
  
  return workPermits;
}

async function generateAbsenteeismReport(organizationId, parameters) {
  const { startDate, endDate, departmentId } = parameters || {};
  
  let query = sql`
    SELECT 
      e.employee_number,
      e.first_name,
      e.last_name,
      e.department_name,
      ar.date,
      ar.status,
      ar.notes
    FROM attendance_records ar
    JOIN employees e ON e.id = ar.employee_id
    WHERE e.organization_id = ${organizationId}
      AND ar.status = 'absent'
  `;
  
  if (startDate) {
    query = sql`${query} AND ar.date >= ${startDate}`;
  }
  if (endDate) {
    query = sql`${query} AND ar.date <= ${endDate}`;
  }
  if (departmentId) {
    query = sql`${query} AND e.department_id = ${departmentId}`;
  }
  
  query = sql`${query} ORDER BY ar.date DESC, e.last_name`;
  
  return query;
}

async function generateOvertimeReport(organizationId, parameters) {
  const { startDate, endDate, departmentId } = parameters || {};
  
  let query = sql`
    SELECT 
      e.employee_number,
      e.first_name,
      e.last_name,
      e.department_name,
      te.clock_in,
      te.clock_out,
      te.total_hours,
      te.overtime_rate,
      te.status
    FROM time_entries te
    JOIN employees e ON e.id = te.employee_id
    WHERE e.organization_id = ${organizationId}
      AND te.is_overtime = true
  `;
  
  if (startDate) {
    query = sql`${query} AND DATE(te.clock_in) >= ${startDate}`;
  }
  if (endDate) {
    query = sql`${query} AND DATE(te.clock_in) <= ${endDate}`;
  }
  if (departmentId) {
    query = sql`${query} AND e.department_id = ${departmentId}`;
  }
  
  query = sql`${query} ORDER BY te.clock_in DESC, e.last_name`;
  
  return query;
}

async function generatePayslipHistory(organizationId, parameters) {
  const { employeeId, startDate, endDate } = parameters || {};
  
  let query = sql`
    SELECT 
      p.id,
      p.payroll_period,
      p.pay_date,
      e.employee_number,
      e.first_name,
      e.last_name,
      p.basic_salary,
      p.overtime_pay,
      p.allowances,
      p.deductions,
      p.gross_pay,
      p.net_pay,
      p.ssb_contribution,
      p.income_tax,
      p.status
    FROM payslips p
    JOIN employees e ON e.id = p.employee_id
    WHERE e.organization_id = ${organizationId}
  `;
  
  if (employeeId) {
    query = sql`${query} AND p.employee_id = ${employeeId}`;
  }
  if (startDate) {
    query = sql`${query} AND p.pay_date >= ${startDate}`;
  }
  if (endDate) {
    query = sql`${query} AND p.pay_date <= ${endDate}`;
  }
  
  query = sql`${query} ORDER BY p.pay_date DESC, e.last_name`;
  
  return query;
}

async function generateCostPerEmployee(organizationId, parameters) {
  const { year, departmentId } = parameters || {};
  const currentYear = year || new Date().getFullYear();
  
  let query = sql`
    SELECT 
      e.employee_number,
      e.first_name,
      e.last_name,
      e.department_name,
      e.position_name,
      e.base_salary,
      COALESCE(
        (SELECT SUM(p.overtime_pay) FROM payslips p 
         WHERE p.employee_id = e.id 
         AND EXTRACT(YEAR FROM TO_DATE(p.pay_date, 'YYYY-MM-DD')) = ${currentYear}), 0
      ) as overtime_pay,
      COALESCE(
        (SELECT SUM(p.allowances) FROM payslips p 
         WHERE p.employee_id = e.id
         AND EXTRACT(YEAR FROM TO_DATE(p.pay_date, 'YYYY-MM-DD')) = ${currentYear}), 0
      ) as total_allowances,
      COALESCE(
        (SELECT SUM(p.ssb_contribution) FROM payslips p 
         WHERE p.employee_id = e.id
         AND EXTRACT(YEAR FROM TO_DATE(p.pay_date, 'YYYY-MM-DD')) = ${currentYear}), 0
      ) as employer_ssb,
      COALESCE(
        (SELECT SUM(p.income_tax) FROM payslips p 
         WHERE p.employee_id = e.id
         AND EXTRACT(YEAR FROM TO_DATE(p.pay_date, 'YYYY-MM-DD')) = ${currentYear}), 0
      ) as employer_taxes
    FROM employees e
    WHERE e.organization_id = ${organizationId}
      AND e.employment_status = 'active'
  `;
  
  if (departmentId) {
    query = sql`${query} AND e.department_id = ${departmentId}`;
  }
  
  query = sql`${query} ORDER BY e.department_name, e.last_name`;
  
  return query;
}

async function generateLeaveSummary(organizationId, parameters) {
  const { startDate, endDate } = parameters || {};
  
  let query = sql`
    SELECT 
      e.employee_number,
      e.first_name,
      e.last_name,
      e.department_name,
      lb.leave_type,
      lb.year,
      lb.entitled_days,
      lb.used_days,
      lb.balance
    FROM leave_balances lb
    JOIN employees e ON e.id = lb.employee_id
    WHERE e.organization_id = ${organizationId}
    ORDER BY e.last_name, lb.leave_type
  `;
  
  return query;
}

async function generateAttendanceReport(organizationId, parameters) {
  const { startDate, endDate, departmentId } = parameters || {};
  
  let query = sql`
    SELECT 
      e.employee_number,
      e.first_name,
      e.last_name,
      e.department_name,
      ar.date,
      ar.clock_in,
      ar.clock_out,
      ar.total_hours,
      ar.status
    FROM attendance_records ar
    JOIN employees e ON e.id = ar.employee_id
    WHERE e.organization_id = ${organizationId}
  `;
  
  if (startDate) {
    query = sql`${query} AND ar.date >= ${startDate}`;
  }
  if (endDate) {
    query = sql`${query} AND ar.date <= ${endDate}`;
  }
  
  query = sql`${query} ORDER BY ar.date DESC, e.last_name`;
  
  return query;
}

async function generatePayrollSummary(organizationId, parameters) {
  const { periodId } = parameters || {};
  
  let query = sql`
    SELECT 
      pr.period_start,
      pr.period_end,
      pr.status as payroll_status,
      e.employee_number,
      e.first_name,
      e.last_name,
      pr.gross_pay,
      pr.net_pay,
      pr.ssb_deduction,
      pr.paye_deduction,
      pr.other_deductions
    FROM payroll_runs pr
    JOIN employees e ON e.id = pr.employee_id
    WHERE e.organization_id = ${organizationId}
  `;
  
  if (periodId) {
    query = sql`${query} AND pr.id = ${periodId}`;
  }
  
  query = sql`${query} ORDER BY pr.period_start DESC, e.last_name`;
  
  return query;
}

async function generateTurnoverReport(organizationId, parameters) {
  const { year, quarter } = parameters || {};
  const currentYear = year || new Date().getFullYear();
  
  // Get new hires
  const newHires = await sql`
    SELECT 
      DATE_TRUNC('month', TO_DATE(hire_date, 'YYYY-MM-DD')) as month,
      COUNT(*) as new_hires
    FROM employees
    WHERE organization_id = ${organizationId}
      AND EXTRACT(YEAR FROM TO_DATE(hire_date, 'YYYY-MM-DD')) = ${currentYear}
    GROUP BY DATE_TRUNC('month', TO_DATE(hire_date, 'YYYY-MM-DD'))
    ORDER BY month
  `;
  
  // Get terminations
  const terminations = await sql`
    SELECT 
      DATE_TRUNC('month', TO_DATE(termination_date, 'YYYY-MM-DD')) as month,
      COUNT(*) as terminations
    FROM employees
    WHERE organization_id = ${organizationId}
      AND termination_date IS NOT NULL
      AND EXTRACT(YEAR FROM TO_DATE(termination_date, 'YYYY-MM-DD')) = ${currentYear}
    GROUP BY DATE_TRUNC('month', TO_DATE(termination_date, 'YYYY-MM-DD'))
    ORDER BY month
  `;
  
  // Calculate turnover rate
  const totalEmployees = await sql`
    SELECT COUNT(*) as count FROM employees
    WHERE organization_id = ${organizationId}
      AND employment_status = 'active'
  `;
  
  return {
    year: currentYear,
    newHires,
    terminations,
    totalActiveEmployees: totalEmployees[0]?.count || 0
  };
}

async function generateComplianceReport(organizationId) {
  // Work permit expirations
  const workPermits = await sql`
    SELECT 
      employee_number,
      first_name,
      last_name,
      work_permit_number,
      work_permit_expiry,
      CASE 
        WHEN TO_DATE(work_permit_expiry, 'YYYY-MM-DD') - CURRENT_DATE <= 30 THEN 'Expiring in 30 days'
        WHEN TO_DATE(work_permit_expiry, 'YYYY-MM-DD') - CURRENT_DATE <= 60 THEN 'Expiring in 60 days'
        WHEN TO_DATE(work_permit_expiry, 'YYYY-MM-DD') - CURRENT_DATE <= 90 THEN 'Expiring in 90 days'
        ELSE 'Valid'
      END as expiry_status
    FROM employees
    WHERE organization_id = ${organizationId}
      AND work_permit_expiry IS NOT NULL
      AND employment_status = 'active'
    ORDER BY work_permit_expiry
  `;
  
  return workPermits;
}

async function generateMyPayslips(organizationId, userId) {
  const payslips = await sql`
    SELECT 
      pr.period_start,
      pr.period_end,
      pr.gross_pay,
      pr.net_pay,
      pr.ssb_deduction,
      pr.paye_deduction,
      pr.status
    FROM payroll_runs pr
    JOIN users u ON u.employee_id = pr.employee_id
    WHERE u.id = ${userId}
    ORDER BY pr.period_start DESC
    LIMIT 24
  `;
  return payslips;
}

async function generateMyLeaveSummary(organizationId, userId) {
  const balances = await sql`
    SELECT 
      lb.leave_type,
      lb.year,
      lb.entitled_days,
      lb.used_days,
      lb.balance
    FROM leave_balances lb
    JOIN users u ON u.employee_id = lb.employee_id
    WHERE u.id = ${userId}
    ORDER BY lb.year DESC, lb.leave_type
  `;
  return balances;
}

async function generateMyAttendance(organizationId, userId, parameters) {
  const { startDate, endDate } = parameters || {};
  const currentMonth = new Date().toISOString().slice(0, 7);
  
  let query = sql`
    SELECT 
      ar.date,
      ar.clock_in,
      ar.clock_out,
      ar.total_hours,
      ar.status
    FROM attendance_records ar
    JOIN users u ON u.employee_id = ar.employee_id
    WHERE u.id = ${userId}
  `;
  
  if (startDate) {
    query = sql`${query} AND ar.date >= ${startDate}`;
  } else {
    query = sql`${query} AND ar.date >= ${currentMonth}-01`;
  }
  
  if (endDate) {
    query = sql`${query} AND ar.date <= ${endDate}`;
  }
  
  query = sql`${query} ORDER BY ar.date DESC`;
  
  return query;
}

async function generateMyProfile(organizationId, userId) {
  const profile = await sql`
    SELECT 
      employee_number,
      first_name,
      last_name,
      email,
      phone,
      date_of_birth,
      gender,
      nationality,
      tax_id,
      ssb_number,
      work_permit_number,
      work_permit_expiry,
      marital_status,
      address_line_1,
      address_line_2,
      district,
      town_or_city,
      emergency_contact_name,
      emergency_contact_phone,
      hire_date,
      department_name,
      position_name,
      bank_name,
      bank_account_number
    FROM employees
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  return profile;
}

// Helper functions
function convertToCSV(data) {
  if (!data || data.length === 0) return '';
  
  // Handle object with nested arrays (like turnover report)
  if (data.newHires || data.terminations) {
    return JSON.stringify(data, null, 2);
  }
  
  const headers = Object.keys(data[0]);
  const rows = data.map(row => 
    headers.map(header => {
      const value = row[header];
      const stringValue = String(value ?? '');
      if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    }).join(',')
  );
  
  return [headers.join(','), ...rows].join('\n');
}

async function sendNotification(organizationId, userId, reportType, s3Key) {
  try {
    // Get user email
    const users = await sql`SELECT email, first_name FROM users WHERE id = ${userId}`;
    
    if (users.length === 0) return;
    
    const user = users[0];
    
    // Generate pre-signed URL for download
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
    });
    const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 86400 }); // 24 hours
    
    await sendEmailViaZeptoMail(
      user.email,
      `Your ${reportType} Report is Ready - Staff Flow HRM`,
      `Your ${reportType} report is ready for download.\n\nClick the link below to download your report:\n${downloadUrl}\n\nThis link will expire in 24 hours.\n\nThank you,\nStaff Flow HRM`
    );
    console.log('Notification sent to:', user.email);
  } catch (error) {
    console.error('Error sending notification:', error);
    // Don't fail the report generation if notification fails
  }
}
