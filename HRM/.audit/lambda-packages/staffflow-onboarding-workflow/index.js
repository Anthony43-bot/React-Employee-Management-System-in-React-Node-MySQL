/**
 * Staff Flow Onboarding Workflow Lambda Function
 *
 * Triggered by Cognito post-confirmation.
 */

const https = require('https');
const { neon } = require('@neondatabase/serverless');
const { CognitoIdentityProviderClient, AdminAddUserToGroupCommand } = require('@aws-sdk/client-cognito-identity-provider');

const DATABASE_URL = process.env.DATABASE_URL;
const FROM_EMAIL = process.env.FROM_EMAIL || process.env.WELCOME_FROM_EMAIL || process.env.SES_FROM_EMAIL || 'welcome@stafflow.bz';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const APP_URL = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://stafflow.bz').replace(/\/$/, '');
const ZEPTOMAIL_API_KEY = process.env.ZEPTOMAIL_API_KEY || process.env.ZEPTOMAIL_BULK_API_KEY;

const sql = neon(DATABASE_URL);
const cognitoClient = new CognitoIdentityProviderClient({ region: AWS_REGION });

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

async function addUserToGroup(username, role) {
  const groupMap = {
    owner: 'Owners',
    hr_manager: 'HR_Managers',
    payroll_manager: 'Payroll_Managers',
    manager: 'Managers',
    employee: 'Employees',
  };

  const groupName = groupMap[role] || 'Employees';

  try {
    await cognitoClient.send(new AdminAddUserToGroupCommand({
      UserPoolId: COGNITO_USER_POOL_ID,
      Username: username,
      GroupName: groupName,
    }));
    console.log(`Added user ${username} to group ${groupName}`);
    return { success: true, groupName };
  } catch (error) {
    console.error('Error adding user to group:', error);
    return { success: false, error: error.message };
  }
}

async function createOrUpdateEmployee(user) {
  const existingEmployee = await sql`SELECT id FROM employees WHERE email = ${user.email}`;
  if (existingEmployee.length > 0) {
    console.log(`Employee already exists for email: ${user.email}`);
    return { employeeId: existingEmployee[0].id, isNew: false };
  }

  const result = await sql`
    INSERT INTO employees (
      organization_id,
      employee_number,
      first_name,
      last_name,
      email,
      hire_date,
      employment_status,
      employment_type,
      created_at
    )
    VALUES (
      ${user.custom_org_id || null},
      (SELECT COALESCE(MAX(employee_number::int), 0) + 1 FROM employees WHERE organization_id = ${user.custom_org_id})::text,
      ${user.given_name},
      ${user.family_name},
      ${user.email},
      CURRENT_DATE,
      'active',
      'full_time',
      NOW()
    )
    RETURNING id
  `;

  return { employeeId: result[0]?.id, isNew: true };
}

async function createOnboardingTask(employeeId, organizationId, userRole) {
  if (userRole !== 'employee') {
    console.log('Skipping onboarding task for non-employee role');
    return null;
  }

  const hrManager = await sql`
    SELECT u.id
    FROM users u
    WHERE u.organization_id = ${organizationId}
      AND u.role = 'hr_manager'
    LIMIT 1
  `;

  if (hrManager.length === 0) {
    console.log('No HR manager found for organization');
    return null;
  }

  const tasks = [
    { task_type: 'collect_emergency_contact', due_days: 7 },
    { task_type: 'collect_bank_details', due_days: 7 },
    { task_type: 'collect_id_documents', due_days: 14 },
    { task_type: 'review_employment_contract', due_days: 14 },
    { task_type: 'schedule_orientation', due_days: 3 },
  ];

  const createdTasks = [];
  for (const task of tasks) {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + task.due_days);

    const result = await sql`
      INSERT INTO onboarding_tasks (
        employee_id,
        task_type,
        status,
        assigned_to,
        due_date,
        created_at
      )
      VALUES (
        ${employeeId},
        ${task.task_type},
        'pending',
        ${hrManager[0].id},
        ${dueDate.toISOString()},
        NOW()
      )
      RETURNING id
    `;
    createdTasks.push(result[0]?.id);
  }

  return createdTasks;
}

async function sendWelcomeEmail(user, employeeId, organizationId, userRole) {
  const roleContent = {
    owner: `
      <li>Set up your organization profile and billing information</li>
      <li>Invite team members to join your organization</li>
      <li>Configure your organization's compliance settings</li>
    `,
    hr_manager: `
      <li>Complete employee onboarding tasks assigned to you</li>
      <li>Review and manage employee records</li>
      <li>Set up departments and positions</li>
    `,
    manager: `
      <li>Review your team member information</li>
      <li>Approve leave requests from your team</li>
      <li>Set up your team's schedule</li>
    `,
    employee: `
      <li>Complete your profile with emergency contact information</li>
      <li>Set up your direct deposit for payroll</li>
      <li>Review and sign your employment documents</li>
    `,
  };

  const htmlContent = `
    <html>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #0066cc 0%, #004499 100%); padding: 30px; text-align: center;">
          <h1 style="color: white; margin: 0;">Welcome to Staff Flow!</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <h2 style="color: #333;">Hello ${user.given_name}!</h2>
          <p style="color: #666; line-height: 1.6;">
            Welcome to Staff Flow HR Management System. We're excited to have you on board!
          </p>
          <h3 style="color: #333;">Your Next Steps:</h3>
          <ul style="color: #666; line-height: 1.8;">
            ${roleContent[userRole] || roleContent.employee}
            <li>Log in to your dashboard to get started</li>
          </ul>
          <div style="margin-top: 30px; text-align: center;">
            <a href="${APP_URL}/login" style="background: #0066cc; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">Log In to Staff Flow</a>
          </div>
        </div>
      </body>
    </html>
  `;

  try {
    await sendEmailViaZeptoMail(user.email, 'Welcome to Staff Flow!', htmlContent);
    console.log(`Welcome email sent to ${user.email}`);
    return true;
  } catch (error) {
    console.error('Failed to send welcome email:', error);
    return false;
  }
}

exports.handler = async (event) => {
  console.log('Onboarding Workflow Lambda invoked');
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    const { userName, request } = event;
    const userAttributes = request?.userAttributes;
    if (!userAttributes) {
      console.error('No user attributes in event');
      return event;
    }

    const user = {
      sub: userName,
      email: userAttributes.email,
      given_name: userAttributes.given_name || userAttributes.name?.split(' ')[0] || 'User',
      family_name: userAttributes.family_name || userAttributes.name?.split(' ').slice(1).join(' ') || '',
      custom_role: userAttributes['custom:role'] || 'employee',
      custom_org_id: userAttributes['custom:org_id'],
    };

    const groupResult = await addUserToGroup(user.sub, user.custom_role);
    if (!groupResult.success) {
      console.error('Failed to add user to group:', groupResult.error);
    }

    let employeeResult = null;
    if (user.custom_role === 'owner' && !user.custom_org_id) {
      console.log('New owner - skipping employee record creation until org is set up');
    } else {
      employeeResult = await createOrUpdateEmployee(user);
    }

    if (employeeResult?.employeeId && user.custom_org_id) {
      await createOnboardingTask(employeeResult.employeeId, user.custom_org_id, user.custom_role);
    }

    await sendWelcomeEmail(user, employeeResult?.employeeId, user.custom_org_id, user.custom_role);
    return event;
  } catch (error) {
    console.error('Error in onboarding workflow:', error);
    return event;
  }
};
