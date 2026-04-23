/**
 * Payroll Processor Lambda Function
 * 
 * Handles background payroll calculations for organizations
 * Triggered via API Gateway or CloudWatch Events
 */

const { getDbConnection, executeWithRetry } = require('../shared/db');
const { sendEmail } = require('../shared/email');

// Belize tax rates (2024) - These should be configurable via database
const TAX_RATES = {
  // SSB Employee Contribution (5.1% of gross, capped at BZD 1,250/month)
  SSB_EMPLOYEE_RATE: 0.051,
  SSB_EMPLOYEE_CAP: 1250,
  
  // SSB Employer Contribution (8% of gross, capped at BZD 1,961.54/month)
  SSB_EMPLOYER_RATE: 0.08,
  SSB_EMPLOYER_CAP: 1961.54,
  
  // PAYE Tax Brackets (monthly)
  TAX_BRACKETS: [
    { min: 0, max: 3000, rate: 0 },
    { min: 3000, max: 5000, rate: 0.10 },
    { min: 5000, max: 8000, rate: 0.20 },
    { min: 8000, max: 15000, rate: 0.25 },
    { min: 15000, max: Infinity, rate: 0.30 }
  ],
  
  // Other deductions
  NHIS_RATE: 0.005,        // 0.5% National Health Insurance
  EDUCATION_TAX_RATE: 0.005, // 0.5% Education Tax
  ENVIRONMENTAL_LEVY_RATE: 0.0025 // 0.25% Environmental Levy
};

// ZeptoMail agent for notifications
const NOTIFICATION_AGENT = 'notifications';

/**
 * Calculate SSB contribution
 */
function calculateSSB(grossPay, isEmployer = false) {
  const rate = isEmployer ? TAX_RATES.SSB_EMPLOYER_RATE : TAX_RATES.SSB_EMPLOYEE_RATE;
  const cap = isEmployer ? TAX_RATES.SSB_EMPLOYER_CAP : TAX_RATES.SSB_EMPLOYEE_CAP;
  
  const contribution = grossPay * rate;
  return Math.min(contribution, cap);
}

/**
 * Calculate PAYE tax using progressive brackets
 */
function calculatePAYE(taxableIncome) {
  let totalTax = 0;
  let remainingIncome = taxableIncome;
  
  for (const bracket of TAX_RATES.TAX_BRACKETS) {
    if (remainingIncome <= 0) break;
    
    const taxableInBracket = Math.min(
      remainingIncome,
      bracket.max - bracket.min
    );
    
    totalTax += taxableInBracket * bracket.rate;
    remainingIncome -= taxableInBracket;
  }
  
  return totalTax;
}

/**
 * Calculate all tax deductions for an employee
 */
function calculateTaxDeductions(grossPay) {
  // SSB contributions
  const ssbEmployee = calculateSSB(grossPay, false);
  const ssbEmployer = calculateSSB(grossPay, true);
  
  // Taxable income (gross - SSB employee contribution)
  const taxableIncome = Math.max(0, grossPay - ssbEmployee);
  
  // PAYE
  const paye = calculatePAYE(taxableIncome);
  
  // Other deductions
  const nhis = grossPay * TAX_RATES.NHIS_RATE;
  const educationTax = grossPay * TAX_RATES.EDUCATION_TAX_RATE;
  const environmentalLevy = grossPay * TAX_RATES.ENVIRONMENTAL_LEVY_RATE;
  
  const totalDeductions = ssbEmployee + paye + nhis + educationTax + environmentalLevy;
  const netPay = grossPay - totalDeductions;
  
  return {
    grossPay,
    taxableIncome,
    incomeTax: paye,
    ssbEmployee,
    ssbEmployer,
    nhis,
    educationTax,
    environmentalLevy,
    totalDeductions,
    netPay
  };
}

/**
 * Fetch active employees for an organization
 */
async function fetchActiveEmployees(sql, organizationId) {
  return executeWithRetry(
    `SELECT 
      e.*,
      u.email as user_email
    FROM employees e
    LEFT JOIN users u ON u.employee_id = e.id
    WHERE e.organization_id = $1 
      AND e.employment_status = 'active'
      AND e.base_salary IS NOT NULL
    ORDER BY e.employee_number`,
    [organizationId]
  );
}

/**
 * Get or create payroll period
 */
async function getOrCreatePayrollPeriod(sql, organizationId, payPeriodStart, payPeriodEnd) {
  // Check if period exists
  const existing = await executeWithRetry(
    `SELECT * FROM payroll_periods 
     WHERE organization_id = $1 
       AND start_date = $2 
       AND end_date = $3`,
    [organizationId, payPeriodStart, payPeriodEnd]
  );
  
  if (existing.length > 0) {
    return existing[0];
  }
  
  // Create new period
  const paymentDate = new Date(payPeriodEnd);
  paymentDate.setDate(paymentDate.getDate() + 5); // Pay 5 days after period end
  
  const result = await executeWithRetry(
    `INSERT INTO payroll_periods (organization_id, name, start_date, end_date, payment_date, status)
     VALUES ($1, $2, $3, $4, $5, 'draft')
     RETURNING *`,
    [
      organizationId,
      `Pay Period ${payPeriodStart} to ${payPeriodEnd}`,
      payPeriodStart,
      payPeriodEnd,
      paymentDate.toISOString().split('T')[0]
    ]
  );
  
  return result[0];
}

/**
 * Create payroll run record
 */
async function createPayrollRun(sql, organizationId, payrollPeriodId) {
  const result = await executeWithRetry(
    `INSERT INTO payroll_runs (organization_id, payroll_period_id, status)
     VALUES ($1, $2, 'processing')
     RETURNING *`,
    [organizationId, payrollPeriodId]
  );
  return result[0];
}

/**
 * Create payslip for an employee
 */
async function createPayslip(sql, employee, payrollRun, payrollPeriod, deductions) {
  const result = await executeWithRetry(
    `INSERT INTO payslips (
      organization_id,
      employee_id,
      payroll_run_id,
      payroll_period,
      pay_date,
      basic_salary,
      overtime_pay,
      allowances,
      deductions,
      gross_pay,
      net_pay,
      ssb_contribution,
      income_tax,
      status,
      generated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'generated', NOW())
    RETURNING *`,
    [
      employee.organization_id,
      employee.id,
      payrollRun.id,
      `${payrollPeriod.start_date} to ${payrollPeriod.end_date}`,
      payrollPeriod.payment_date,
      employee.base_salary,
      0, // overtime (to be calculated)
      0, // allowances (to be calculated)
      deductions.totalDeductions,
      deductions.grossPay,
      deductions.netPay,
      deductions.ssbEmployee,
      deductions.incomeTax
    ]
  );
  
  return result[0];
}

/**
 * Create tax deduction record
 */
async function createTaxDeduction(sql, employee, payrollPeriod, deductions) {
  const result = await executeWithRetry(
    `INSERT INTO tax_deductions (
      organization_id,
      employee_id,
      payroll_period,
      gross_income,
      taxable_income,
      income_tax,
      ssb_employee,
      ssb_employer,
      nhis,
      education_tax,
      environmental_levy,
      total_deductions
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *`,
    [
      employee.organization_id,
      employee.id,
      `${payrollPeriod.start_date} to ${payrollPeriod.end_date}`,
      deductions.grossPay,
      deductions.taxableIncome,
      deductions.incomeTax,
      deductions.ssbEmployee,
      deductions.ssbEmployer,
      deductions.nhis,
      deductions.educationTax,
      deductions.environmentalLevy,
      deductions.totalDeductions
    ]
  );
  
  return result[0];
}

/**
 * Update payroll run status
 */
async function updatePayrollRunStatus(sql, payrollRunId, status) {
  return executeWithRetry(
    `UPDATE payroll_runs 
     SET status = $1, processed_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [status, payrollRunId]
  );
}

/**
 * Send payslip notification email via ZeptoMail
 */
async function sendPayslipNotification(employee, payslip) {
  const displayName = `${employee.first_name} ${employee.last_name}`.trim();
  
  const subject = `Pay Slip Available - ${payslip.payroll_period}`;
  
  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f5f5f5; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .card { background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #10B981, #059669); padding: 30px; text-align: center; }
    .header h1 { color: white; margin: 0; font-size: 28px; }
    .content { padding: 30px; }
    .summary-box { background: #f9fafb; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .amount { font-size: 24px; font-weight: bold; color: #10B981; }
    .button { display: inline-block; background: linear-gradient(135deg, #4F46E5, #7C3AED); color: white; padding: 12px 28px; text-decoration: none; border-radius: 8px; margin-top: 20px; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; border-top: 1px solid #e5e7eb; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="header">
        <h1>Pay Slip Available</h1>
      </div>
      <div class="content">
        <p>Dear <strong>${displayName}</strong>,</p>
        
        <p>Your pay slip for the period <strong>${payslip.payroll_period}</strong> is now available.</p>
        
        <div class="summary-box">
          <h3 style="margin-top: 0;">Summary:</h3>
          <p><strong>Gross Pay:</strong> BZD ${parseFloat(payslip.gross_pay).toFixed(2)}</p>
          <p><strong>Deductions:</strong> BZD ${parseFloat(payslip.deductions).toFixed(2)}</p>
          <hr />
          <p><strong>Net Pay:</strong> <span class="amount">BZD ${parseFloat(payslip.net_pay).toFixed(2)}</span></p>
        </div>
        
        <div style="text-align: center;">
          <a href="https://stafflow.bz/dashboard/payroll/payslips" class="button">View Full Pay Slip</a>
        </div>
        
        <p>Please log in to the Staff Flow HR portal to view and download your complete pay slip.</p>
        
        <p>Best regards,<br/>HR Department</p>
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

  const textBody = `
Pay Slip Notification

Dear ${displayName},

Your pay slip for the period ${payslip.payroll_period} is now available.

Summary:
- Gross Pay: BZD ${parseFloat(payslip.gross_pay).toFixed(2)}
- Deductions: BZD ${parseFloat(payslip.deductions).toFixed(2)}
- Net Pay: BZD ${parseFloat(payslip.net_pay).toFixed(2)}

Please log in to https://stafflow.bz/dashboard/payroll/payslips to view your complete pay slip.

Best regards,
HR Department
  `;
  
  if (employee.user_email) {
    return sendEmail(
      employee.user_email, 
      subject, 
      htmlBody, 
      textBody, 
      process.env.NOTIFICATIONS_FROM_EMAIL || 'notifications@stafflow.bz',
      displayName
    );
  }
  return { success: false, error: 'No email address' };
}

/**
 * Main Lambda handler
 */
exports.handler = async (event) => {
  console.log('📊 Payroll Processor started:', JSON.stringify(event));
  
  // Handle different trigger types
  let organizationId, payPeriodStart, payPeriodEnd;
  
  if (event.httpMethod) {
    // API Gateway trigger - parse body
    const body = JSON.parse(event.body || '{}');
    organizationId = body.organizationId;
    payPeriodStart = body.payPeriodStart;
    payPeriodEnd = body.payPeriodEnd;
  } else if (event.organizationId) {
    // Direct invocation
    organizationId = event.organizationId;
    payPeriodStart = event.payPeriodStart;
    payPeriodEnd = event.payPeriodEnd;
  } else if (event.detail) {
    // EventBridge/SNS trigger
    organizationId = event.detail.organizationId;
    payPeriodStart = event.detail.payPeriodStart;
    payPeriodEnd = event.detail.payPeriodEnd;
  } else {
    // CloudWatch scheduled - use current month
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    payPeriodStart = `${year}-${month}-01`;
    const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
    payPeriodEnd = `${year}-${month}-${lastDay}`;
    organizationId = event.organizationId || null; // Process all organizations if not specified
  }
  
  // Validate required parameters
  if (!organizationId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'organizationId is required' })
    };
  }
  
  const sql = getDbConnection();
  
  try {
    // Get or create payroll period
    const payrollPeriod = await getOrCreatePayrollPeriod(
      sql, 
      organizationId, 
      payPeriodStart || `${new Date().getFullYear()}-01-01`,
      payPeriodEnd || `${new Date().getFullYear()}-12-31`
    );
    
    // Create payroll run
    const payrollRun = await createPayrollRun(sql, organizationId, payrollPeriod.id);
    
    // Fetch active employees
    const employees = await fetchActiveEmployees(sql, organizationId);
    
    console.log(`Processing payroll for ${employees.length} employees`);
    
    let successCount = 0;
    let failCount = 0;
    const errors = [];
    
    // Process each employee
    for (const employee of employees) {
      try {
        // Calculate deductions (using base salary - would need to add overtime/allowances from DB)
        const grossPay = parseFloat(employee.base_salary);
        const deductions = calculateTaxDeductions(grossPay);
        
        // Create payslip
        const payslip = await createPayslip(sql, employee, payrollRun, payrollPeriod, deductions);
        
        // Create tax deduction record
        await createTaxDeduction(sql, employee, payrollPeriod, deductions);
        
        // Send notification (async, don't wait)
        try {
          await sendPayslipNotification(employee, payslip);
        } catch (emailError) {
          console.error(`Failed to send email for employee ${employee.id}:`, emailError);
        }
        
        successCount++;
      } catch (empError) {
        console.error(`Failed to process payroll for employee ${employee.id}:`, empError);
        failCount++;
        errors.push({ employeeId: employee.id, error: empError.message });
      }
    }
    
    // Update payroll run status
    const finalStatus = failCount === 0 ? 'completed' : 'completed_with_errors';
    await updatePayrollRunStatus(sql, payrollRun.id, finalStatus);
    
    const response = {
      payrollRunId: payrollRun.id,
      periodId: payrollPeriod.id,
      organizationId,
      status: finalStatus,
      totalEmployees: employees.length,
      successCount,
      failCount,
      errors: errors.length > 0 ? errors : undefined
    };
    
    console.log('✅ Payroll Processor completed:', response);
    
    // Return appropriate response based on trigger
    if (event.httpMethod) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(response)
      };
    }
    
    return response;
    
  } catch (error) {
    console.error('❌ Payroll Processor failed:', error);
    
    if (event.httpMethod) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: error.message })
      };
    }
    
    throw error;
  }
};