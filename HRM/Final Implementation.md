Implement a complete role-based authentication and onboarding system for my Belize HRM application with proper database schema and security levels.

## Business Requirements:
- When a user signs up, they become the **Organization Owner/Admin**
- After signup, they complete **onboarding** to create their business profile
- Once onboarded, they can **add employees** who get their own login credentials
- Different **roles** with varying permissions:
  - **Organization Owner** - Full access to everything
  - **HR Manager** - Can manage employees, approve leave, handle documents
  - **Payroll Manager** - Can process payroll, access salary info, generate reports
  - **Department Manager** - Can approve time-off for their team, view team reports
  - **Employee** - Can clock in/out, request leave, view own payslips

## Current Database Schema (from Neon):
**users table:**
- id (uuid) - Primary key
- organization_id (uuid) - Links to organizations table
- email (text) - User's email
- role (text) - User's role (owner, hr_manager, payroll_manager, manager, employee)
- employee_id (uuid) - Links to employees table (null for owners initially)
- is_active (boolean) - Whether account is active
- last_login_at (timestamp)

## Required Implementation:

### Phase 1: Fix Signup & Onboarding Flow

#### 1.1 Update Signup Function (src/actions/auth.ts)
```typescript
export async function signUp(userData: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
}): Promise<SignUpResult> {
  try {
    // Create user in Cognito (admin bypass for development)
    const username = `user_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const formattedPhone = userData.phone.replace(/-/g, '');
    
    // Create in Cognito with admin privileges
    const createCommand = new AdminCreateUserCommand({
      UserPoolId: process.env.COGNITO_USER_POOL_ID!,
      Username: username,
      TemporaryPassword: userData.password,
      MessageAction: "SUPPRESS", // Skip email for now
      UserAttributes: [
        { Name: "email", Value: userData.email },
        { Name: "email_verified", Value: "true" },
        { Name: "given_name", Value: userData.firstName },
        { Name: "family_name", Value: userData.lastName },
        { Name: "phone_number", Value: formattedPhone },
        { Name: "custom:role", Value: "owner" }, // Set as owner initially
      ],
    });

    await cognitoClient.send(createCommand);
    
    // Set permanent password
    const setPasswordCommand = new AdminSetUserPasswordCommand({
      UserPoolId: process.env.COGNITO_USER_POOL_ID!,
      Username: username,
      Password: userData.password,
      Permanent: true,
    });
    await cognitoClient.send(setPasswordCommand);
    
    // Insert minimal user record in database
    await db.insert(users).values({
      id: username,
      email: userData.email,
      role: "owner", // Default role
      is_active: true,
      organization_id: null, // Will be set during onboarding
      employee_id: null, // Will be set after employee record created
    });
    
    // Store user data temporarily for onboarding
    // Option: Use cookies or a temporary table
    await setTempUserData(username, {
      firstName: userData.firstName,
      lastName: userData.lastName,
      phone: formattedPhone,
      email: userData.email
    });
    
    return { 
      success: true, 
      userSub: username,
      message: "Account created! Redirecting to onboarding..." 
    };
  } catch (error) {
    console.error("Signup error:", error);
    return { success: false, error: error.message };
  }
}
1.2 Create Temporary Storage for Onboarding Data
typescript
// lib/temp-storage.ts
import { cookies } from "next/headers";

export async function setTempUserData(userId: string, data: any) {
  const cookieStore = await cookies();
  cookieStore.set(`pending_${userId}`, JSON.stringify(data), {
    maxAge: 3600, // 1 hour
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
}

export async function getTempUserData(userId: string) {
  const cookieStore = await cookies();
  const data = cookieStore.get(`pending_${userId}`)?.value;
  return data ? JSON.parse(data) : null;
}

export async function clearTempUserData(userId: string) {
  const cookieStore = await cookies();
  cookieStore.delete(`pending_${userId}`);
}
1.3 Update Onboarding Page/Action
typescript
// app/(auth)/onboarding/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { completeOnboarding } from "@/actions/onboarding";

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  const handleSubmit = async (formData: FormData) => {
    setIsSubmitting(true);
    try {
      const result = await completeOnboarding(formData);
      if (result.success) {
        router.push("/dashboard");
      } else {
        alert(result.error);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-center mb-8">Complete Your Organization Setup</h1>
        
        {/* Step indicator */}
        <div className="mb-8">
          <div className="flex justify-between">
            {[1, 2, 3].map((i) => (
              <div key={i} className={`flex-1 border-b-2 ${step >= i ? 'border-indigo-600' : 'border-gray-300'}`} />
            ))}
          </div>
        </div>

        <form action={handleSubmit} className="bg-white shadow rounded-lg p-8">
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Business Information</h2>
              
              <div>
                <label className="block text-sm font-medium mb-1">Company Name *</label>
                <input name="companyName" required className="w-full border rounded-md p-2" />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Trade Name (Optional)</label>
                <input name="tradeName" className="w-full border rounded-md p-2" />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">TIN *</label>
                <input name="tin" required className="w-full border rounded-md p-2" />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">SSB Employer Number</label>
                <input name="ssbEmployerNumber" className="w-full border rounded-md p-2" />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Location & Contact</h2>
              
              <div>
                <label className="block text-sm font-medium mb-1">District *</label>
                <select name="district" required className="w-full border rounded-md p-2">
                  <option value="">Select district</option>
                  <option value="Belize">Belize</option>
                  <option value="Cayo">Cayo</option>
                  <option value="Corozal">Corozal</option>
                  <option value="Orange Walk">Orange Walk</option>
                  <option value="Stann Creek">Stann Creek</option>
                  <option value="Toledo">Toledo</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Business Address *</label>
                <textarea name="address" required className="w-full border rounded-md p-2" rows={3} />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Phone Number *</label>
                <input name="phone" required placeholder="+501-123-4567" className="w-full border rounded-md p-2" />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Email *</label>
                <input name="email" type="email" required className="w-full border rounded-md p-2" />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Your Employee Profile</h2>
              <p className="text-gray-600">As the owner, you'll be the first employee record.</p>
              
              <div>
                <label className="block text-sm font-medium mb-1">Job Title *</label>
                <input name="jobTitle" required placeholder="e.g., CEO, Owner" className="w-full border rounded-md p-2" />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Date of Birth *</label>
                <input name="dateOfBirth" type="date" required className="w-full border rounded-md p-2" />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Gender *</label>
                <select name="gender" required className="w-full border rounded-md p-2">
                  <option value="">Select gender</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Nationality *</label>
                <input name="nationality" required placeholder="Belizean" className="w-full border rounded-md p-2" />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">TIN (Personal) *</label>
                <input name="personalTin" required className="w-full border rounded-md p-2" />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">SSB Number *</label>
                <input name="ssbNumber" required className="w-full border rounded-md p-2" />
              </div>
            </div>
          )}

          <div className="flex justify-between mt-8">
            {step > 1 && (
              <button type="button" onClick={() => setStep(step - 1)} className="px-4 py-2 border rounded-md">
                Previous
              </button>
            )}
            
            {step < 3 ? (
              <button type="button" onClick={() => setStep(step + 1)} className="px-4 py-2 bg-indigo-600 text-white rounded-md ml-auto">
                Next
              </button>
            ) : (
              <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-indigo-600 text-white rounded-md ml-auto">
                {isSubmitting ? "Creating..." : "Complete Setup"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
1.4 Create Onboarding Action
typescript
// actions/onboarding.ts
"use server";

import { db } from "@/lib/db";
import { organizations, employees, departments, positions } from "@/lib/db/schema";
import { getCurrentUser, updateUserWithOrg } from "./auth";
import { getTempUserData, clearTempUserData } from "@/lib/temp-storage";
import { redirect } from "next/navigation";

export async function completeOnboarding(formData: FormData) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: "Not authenticated" };
    }

    // Get temporary user data
    const tempData = await getTempUserData(currentUser.id);
    
    // 1. Create organization
    const [organization] = await db.insert(organizations).values({
      name: formData.get("companyName") as string,
      trade_name: formData.get("tradeName") as string || null,
      tin: formData.get("tin") as string,
      ssb_employer_number: formData.get("ssbEmployerNumber") as string || null,
      district: formData.get("district") as string,
      address: formData.get("address") as string,
      phone: formData.get("phone") as string,
      email: formData.get("email") as string,
      subscription_tier: "starter",
      subscription_status: "active",
      settings: {},
    }).returning();

    // 2. Create default departments
    const [hrDept] = await db.insert(departments).values({
      organization_id: organization.id,
      name: "Human Resources",
    }).returning();

    const [itDept] = await db.insert(departments).values({
      organization_id: organization.id,
      name: "Information Technology",
    }).returning();

    const [financeDept] = await db.insert(departments).values({
      organization_id: organization.id,
      name: "Finance",
    }).returning();

    // 3. Create default positions
    await db.insert(positions).values([
      {
        organization_id: organization.id,
        title: "CEO / Owner",
        department_id: null,
      },
      {
        organization_id: organization.id,
        title: "HR Manager",
        department_id: hrDept.id,
      },
      {
        organization_id: organization.id,
        title: "Payroll Manager",
        department_id: financeDept.id,
      },
      {
        organization_id: organization.id,
        title: "IT Manager",
        department_id: itDept.id,
      },
      {
        organization_id: organization.id,
        title: "Software Developer",
        department_id: itDept.id,
      },
      {
        organization_id: organization.id,
        title: "Accountant",
        department_id: financeDept.id,
      },
    ]);

    // 4. Create employee record for the owner
    const [employee] = await db.insert(employees).values({
      organization_id: organization.id,
      employee_number: `EMP${Date.now()}`,
      first_name: tempData?.firstName || "",
      last_name: tempData?.lastName || "",
      email: currentUser.email,
      phone: tempData?.phone || "",
      date_of_birth: formData.get("dateOfBirth") as string,
      gender: formData.get("gender") as string,
      nationality: formData.get("nationality") as string,
      tax_id: formData.get("personalTin") as string,
      ssb_number: formData.get("ssbNumber") as string,
      hire_date: new Date().toISOString().split('T')[0],
      employment_status: "active",
      employment_type: "full_time",
      position_id: null, // Will set after we get position ID
      pay_frequency: "monthly",
      address_line_1: formData.get("address") as string, // Use business address for now
      district: formData.get("district") as string,
      town_or_city: "Belize City", // Default, should be collected
      emergency_contact_name: "", // To be filled later
      emergency_contact_phone: "",
      bank_name: "",
      bank_account_number: "",
      bank_branch: "",
    }).returning();

    // 5. Update users table
    await db.update(users)
      .set({ 
        organization_id: organization.id,
        employee_id: employee.id 
      })
      .where(eq(users.id, currentUser.id));

    // 6. Update Cognito custom attributes
    await updateUserWithOrg(organization.id);

    // 7. Clear temporary data
    await clearTempUserData(currentUser.id);

    return { success: true };
    
  } catch (error) {
    console.error("Onboarding error:", error);
    return { success: false, error: "Failed to complete onboarding" };
  }
}
Phase 2: Role-Based Access Control System
2.1 Define Roles and Permissions
typescript
// lib/auth/roles.ts
export const ROLES = {
  OWNER: 'owner',
  HR_MANAGER: 'hr_manager',
  PAYROLL_MANAGER: 'payroll_manager',
  DEPARTMENT_MANAGER: 'manager',
  EMPLOYEE: 'employee',
} as const;

export type Role = typeof ROLES[keyof typeof ROLES];

export const PERMISSIONS = {
  // Organization permissions
  MANAGE_ORGANIZATION: 'manage:organization',
  VIEW_ANALYTICS: 'view:analytics',
  
  // Employee management
  CREATE_EMPLOYEE: 'create:employee',
  VIEW_ALL_EMPLOYEES: 'view:all_employees',
  VIEW_TEAM_EMPLOYEES: 'view:team_employees',
  EDIT_EMPLOYEE: 'edit:employee',
  DEACTIVATE_EMPLOYEE: 'deactivate:employee',
  
  // Leave management
  REQUEST_LEAVE: 'request:leave',
  APPROVE_TEAM_LEAVE: 'approve:team_leave',
  APPROVE_ALL_LEAVE: 'approve:all_leave',
  VIEW_LEAVE_REPORTS: 'view:leave_reports',
  
  // Payroll
  PROCESS_PAYROLL: 'process:payroll',
  VIEW_PAYROLL: 'view:payroll',
  VIEW_OWN_PAYSLIP: 'view:own_payslip',
  VIEW_ALL_PAYSLIPS: 'view:all_payslips',
  
  // Time & Attendance
  CLOCK_IN_OUT: 'clock:in_out',
  VIEW_OWN_TIMESHEET: 'view:own_timesheet',
  VIEW_TEAM_TIMESHEET: 'view:team_timesheet',
  VIEW_ALL_TIMESHEETS: 'view:all_timesheets',
  APPROVE_TIMESHEET: 'approve:timesheet',
  
  // Documents
  UPLOAD_DOCUMENTS: 'upload:documents',
  VIEW_OWN_DOCUMENTS: 'view:own_documents',
  VIEW_ALL_DOCUMENTS: 'view:all_documents',
  SIGN_DOCUMENTS: 'sign:documents',
  
  // Reports
  GENERATE_REPORTS: 'generate:reports',
  EXPORT_DATA: 'export:data',
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [ROLES.OWNER]: [
    PERMISSIONS.MANAGE_ORGANIZATION,
    PERMISSIONS.VIEW_ANALYTICS,
    PERMISSIONS.CREATE_EMPLOYEE,
    PERMISSIONS.VIEW_ALL_EMPLOYEES,
    PERMISSIONS.EDIT_EMPLOYEE,
    PERMISSIONS.DEACTIVATE_EMPLOYEE,
    PERMISSIONS.REQUEST_LEAVE,
    PERMISSIONS.APPROVE_ALL_LEAVE,
    PERMISSIONS.VIEW_LEAVE_REPORTS,
    PERMISSIONS.PROCESS_PAYROLL,
    PERMISSIONS.VIEW_PAYROLL,
    PERMISSIONS.VIEW_ALL_PAYSLIPS,
    PERMISSIONS.CLOCK_IN_OUT,
    PERMISSIONS.VIEW_ALL_TIMESHEETS,
    PERMISSIONS.APPROVE_TIMESHEET,
    PERMISSIONS.UPLOAD_DOCUMENTS,
    PERMISSIONS.VIEW_ALL_DOCUMENTS,
    PERMISSIONS.SIGN_DOCUMENTS,
    PERMISSIONS.GENERATE_REPORTS,
    PERMISSIONS.EXPORT_DATA,
  ],
  
  [ROLES.HR_MANAGER]: [
    PERMISSIONS.CREATE_EMPLOYEE,
    PERMISSIONS.VIEW_ALL_EMPLOYEES,
    PERMISSIONS.EDIT_EMPLOYEE,
    PERMISSIONS.REQUEST_LEAVE,
    PERMISSIONS.APPROVE_ALL_LEAVE,
    PERMISSIONS.VIEW_LEAVE_REPORTS,
    PERMISSIONS.VIEW_OWN_PAYSLIP,
    PERMISSIONS.CLOCK_IN_OUT,
    PERMISSIONS.VIEW_OWN_TIMESHEET,
    PERMISSIONS.UPLOAD_DOCUMENTS,
    PERMISSIONS.VIEW_ALL_DOCUMENTS,
    PERMISSIONS.SIGN_DOCUMENTS,
    PERMISSIONS.GENERATE_REPORTS,
  ],
  
  [ROLES.PAYROLL_MANAGER]: [
    PERMISSIONS.VIEW_ALL_EMPLOYEES,
    PERMISSIONS.VIEW_PAYROLL,
    PERMISSIONS.VIEW_ALL_PAYSLIPS,
    PERMISSIONS.PROCESS_PAYROLL,
    PERMISSIONS.VIEW_OWN_PAYSLIP,
    PERMISSIONS.CLOCK_IN_OUT,
    PERMISSIONS.VIEW_OWN_TIMESHEET,
    PERMISSIONS.VIEW_ALL_TIMESHEETS,
    PERMISSIONS.VIEW_LEAVE_REPORTS,
    PERMISSIONS.GENERATE_REPORTS,
    PERMISSIONS.EXPORT_DATA,
  ],
  
  [ROLES.DEPARTMENT_MANAGER]: [
    PERMISSIONS.VIEW_TEAM_EMPLOYEES,
    PERMISSIONS.REQUEST_LEAVE,
    PERMISSIONS.APPROVE_TEAM_LEAVE,
    PERMISSIONS.VIEW_OWN_PAYSLIP,
    PERMISSIONS.CLOCK_IN_OUT,
    PERMISSIONS.VIEW_TEAM_TIMESHEET,
    PERMISSIONS.APPROVE_TIMESHEET,
    PERMISSIONS.VIEW_OWN_DOCUMENTS,
    PERMISSIONS.SIGN_DOCUMENTS,
  ],
  
  [ROLES.EMPLOYEE]: [
    PERMISSIONS.VIEW_OWN_EMPLOYEE, // You need to add this
    PERMISSIONS.REQUEST_LEAVE,
    PERMISSIONS.VIEW_OWN_PAYSLIP,
    PERMISSIONS.CLOCK_IN_OUT,
    PERMISSIONS.VIEW_OWN_TIMESHEET,
    PERMISSIONS.VIEW_OWN_DOCUMENTS,
    PERMISSIONS.SIGN_DOCUMENTS,
  ],
};
2.2 Create Permission Check Middleware
typescript
// lib/auth/permissions.ts
import { ROLES, ROLE_PERMISSIONS, Permission } from './roles';
import { getCurrentUser } from '@/actions/auth';

export async function hasPermission(permission: Permission): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user || !user.role) return false;
  
  const userPermissions = ROLE_PERMISSIONS[user.role as keyof typeof ROLE_PERMISSIONS];
  return userPermissions?.includes(permission) || false;
}

export async function requirePermission(permission: Permission) {
  const hasAccess = await hasPermission(permission);
  if (!hasAccess) {
    throw new Error('Unauthorized: You do not have permission to perform this action');
  }
}

export function can(userRole: Role, permission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[userRole];
  return permissions?.includes(permission) || false;
}
2.3 Create Employee Invitation System
typescript
// actions/employees.ts
"use server";

import { db } from "@/lib/db";
import { employees, users } from "@/lib/db/schema";
import { randomBytes } from "crypto";
import { requirePermission } from "@/lib/auth/permissions";
import { PERMISSIONS } from "@/lib/auth/roles";

export async function inviteEmployee(data: {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  role: string;
  departmentId: string;
  positionId: string;
  managerId?: string;
}) {
  // Check permission
  await requirePermission(PERMISSIONS.CREATE_EMPLOYEE);
  
  try {
    const currentUser = await getCurrentUser();
    
    // Generate temporary password
    const tempPassword = randomBytes(8).toString('hex') + '!A1';
    
    // Create user in Cognito
    const username = `emp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    
    const createCommand = new AdminCreateUserCommand({
      UserPoolId: process.env.COGNITO_USER_POOL_ID!,
      Username: username,
      TemporaryPassword: tempPassword,
      UserAttributes: [
        { Name: "email", Value: data.email },
        { Name: "given_name", Value: data.firstName },
        { Name: "family_name", Value: data.lastName },
        { Name: "phone_number", Value: data.phone.replace(/-/g, '') },
        { Name: "custom:role", Value: data.role },
        { Name: "custom:org_id", Value: currentUser.orgId },
      ],
    });
    
    await cognitoClient.send(createCommand);
    
    // Create employee record
    const [employee] = await db.insert(employees).values({
      organization_id: currentUser.orgId,
      employee_number: `EMP${Date.now()}`,
      first_name: data.firstName,
      last_name: data.lastName,
      email: data.email,
      phone: data.phone,
      department_id: data.departmentId,
      position_id: data.positionId,
      manager_id: data.managerId,
      hire_date: new Date().toISOString().split('T')[0],
      employment_status: "active",
      employment_type: "full_time",
      pay_frequency: "monthly",
    }).returning();
    
    // Create user record
    await db.insert(users).values({
      id: username,
      email: data.email,
      role: data.role,
      organization_id: currentUser.orgId,
      employee_id: employee.id,
      is_active: true,
    });
    
    // TODO: Send invitation email with temp password
    
    return { success: true, employee };
    
  } catch (error) {
    console.error("Error inviting employee:", error);
    return { success: false, error: error.message };
  }
}
3. Create Protected Components
3.1 Permission Guard Component
typescript
// components/auth/permission-guard.tsx
"use client";

import { ReactNode } from "react";
import { useSession } from "@/hooks/use-session";
import { can } from "@/lib/auth/permissions";
import { Permission } from "@/lib/auth/roles";

interface PermissionGuardProps {
  children: ReactNode;
  permission: Permission;
  fallback?: ReactNode;
}

export function PermissionGuard({ children, permission, fallback = null }: PermissionGuardProps) {
  const { user } = useSession();
  
  if (!user || !can(user.role, permission)) {
    return fallback;
  }
  
  return <>{children}</>;
}
3.2 Role-Based Dashboard
typescript
// app/(dashboard)/page.tsx
import { getCurrentUser } from "@/actions/auth";
import { OwnerDashboard } from "@/components/dashboards/owner-dashboard";
import { HrDashboard } from "@/components/dashboards/hr-dashboard";
import { PayrollDashboard } from "@/components/dashboards/payroll-dashboard";
import { ManagerDashboard } from "@/components/dashboards/manager-dashboard";
import { EmployeeDashboard } from "@/components/dashboards/employee-dashboard";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  
  switch(user?.role) {
    case 'owner':
      return <OwnerDashboard />;
    case 'hr_manager':
      return <HrDashboard />;
    case 'payroll_manager':
      return <PayrollDashboard />;
    case 'manager':
      return <ManagerDashboard />;
    default:
      return <EmployeeDashboard />;
  }
}
Summary of Changes Needed:
Fix signup to only insert basic user data

Create temporary storage for onboarding data

Build multi-step onboarding form

Create organization and default structures during onboarding

Create employee record for owner

Implement role-based permissions system

Build employee invitation flow

Create role-specific dashboards

Add permission guards throughout the app

This creates a complete system where:

Owners have full access

HR Managers can manage employees and leave

Payroll Managers handle salary and payments

Department Managers oversee their team

Employees have self-service access