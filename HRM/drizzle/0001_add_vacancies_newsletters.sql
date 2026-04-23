-- Migration: Add vacancies and newsletters tables
-- Created: 2026-04-11

-- ============================================
-- VACANCIES TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS "vacancies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "department" text,
  "team" text,
  "location" text,
  "work_mode" text DEFAULT 'onsite',
  "employment_type" text DEFAULT 'full_time',
  "seniority_level" text,
  "description" text,
  "responsibilities" text,
  "requirements" text,
  "benefits" text,
  "salary_min" decimal(12, 2),
  "salary_max" decimal(12, 2),
  "salary_currency" text DEFAULT 'BZD',
  "openings_count" integer DEFAULT 1,
  "status" text DEFAULT 'draft',
  "application_deadline" timestamp,
  "published_at" timestamp,
  "created_by" text REFERENCES "users"("id"),
  "updated_by" text REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT NOW(),
  "updated_at" timestamp DEFAULT NOW()
);

-- Index for organization filtering
CREATE INDEX IF NOT EXISTS "vacancies_organization_id_idx" ON "vacancies"("organization_id");
CREATE INDEX IF NOT EXISTS "vacancies_status_idx" ON "vacancies"("status");
CREATE INDEX IF NOT EXISTS "vacancies_slug_idx" ON "vacancies"("slug");

-- ============================================
-- NEWSLETTERS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS "newsletters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "month" integer NOT NULL,
  "year" integer NOT NULL,
  "subject_line" text,
  "summary" text,
  "content" text NOT NULL,
  "cover_image_url" text,
  "status" text DEFAULT 'draft',
  "audience_scope" text DEFAULT 'all_employees',
  "is_pinned" boolean DEFAULT false,
  "published_at" timestamp,
  "created_by" text REFERENCES "users"("id"),
  "updated_by" text REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT NOW(),
  "updated_at" timestamp DEFAULT NOW()
);

-- Index for organization filtering
CREATE INDEX IF NOT EXISTS "newsletters_organization_id_idx" ON "newsletters"("organization_id");
CREATE INDEX IF NOT EXISTS "newsletters_status_idx" ON "newsletters"("status");
CREATE INDEX IF NOT EXISTS "newsletters_year_month_idx" ON "newsletters"("year", "month");
CREATE INDEX IF NOT EXISTS "newsletters_slug_idx" ON "newsletters"("slug");

-- ============================================
-- ENUM TYPES (if not exist)
-- ============================================

-- Note: PostgreSQL enums are created automatically when used
-- The application uses text fields with string values instead of enums
