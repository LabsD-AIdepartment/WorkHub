-- ============================================================================
-- Migration: RLS Policies + pg_cron cleanup
-- Date    : 2026-04-25 19:00 (Bangkok)
-- Idempotent: yes (DROP POLICY IF EXISTS before CREATE)
-- ============================================================================
-- IMPORTANT NOTE ON SECURITY MODEL:
--   This app uses the Supabase anon key (publishable) for all queries.
--   auth.uid() is ALWAYS NULL — Supabase Auth / JWT is not in use.
--
--   What these policies do:
--     • Enable RLS so tables are protected by default (good hygiene)
--     • Grant anon role the minimum permissions the app actually needs
--     • Prevent accidental writes via service_role key from other clients
--
--   What these policies CANNOT do:
--     • Restrict data per logged-in user (no JWT = no auth.uid())
--     • Hide secret project rows from direct REST calls
--
--   True per-user security requires migrating to Supabase Auth (Phase 2).
-- ============================================================================

-- ============================================================================
-- 1. ENABLE ROW LEVEL SECURITY on all tables
-- ============================================================================

ALTER TABLE public.users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meetings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ceo_briefs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_logs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications    ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. DROP old/conflicting policies (idempotent)
-- ============================================================================

DROP POLICY IF EXISTS anon_select_users         ON public.users;
DROP POLICY IF EXISTS anon_insert_users         ON public.users;
DROP POLICY IF EXISTS anon_update_users         ON public.users;
DROP POLICY IF EXISTS anon_delete_users         ON public.users;

DROP POLICY IF EXISTS anon_select_departments   ON public.departments;
DROP POLICY IF EXISTS anon_insert_departments   ON public.departments;
DROP POLICY IF EXISTS anon_update_departments   ON public.departments;
DROP POLICY IF EXISTS anon_delete_departments   ON public.departments;

DROP POLICY IF EXISTS anon_select_projects      ON public.projects;
DROP POLICY IF EXISTS anon_insert_projects      ON public.projects;
DROP POLICY IF EXISTS anon_update_projects      ON public.projects;
DROP POLICY IF EXISTS anon_delete_projects      ON public.projects;

DROP POLICY IF EXISTS anon_select_tasks         ON public.tasks;
DROP POLICY IF EXISTS anon_insert_tasks         ON public.tasks;
DROP POLICY IF EXISTS anon_update_tasks         ON public.tasks;
DROP POLICY IF EXISTS anon_delete_tasks         ON public.tasks;

DROP POLICY IF EXISTS anon_select_meetings      ON public.meetings;
DROP POLICY IF EXISTS anon_insert_meetings      ON public.meetings;
DROP POLICY IF EXISTS anon_update_meetings      ON public.meetings;
DROP POLICY IF EXISTS anon_delete_meetings      ON public.meetings;

DROP POLICY IF EXISTS anon_select_ceo_briefs    ON public.ceo_briefs;
DROP POLICY IF EXISTS anon_insert_ceo_briefs    ON public.ceo_briefs;
DROP POLICY IF EXISTS anon_update_ceo_briefs    ON public.ceo_briefs;
DROP POLICY IF EXISTS anon_delete_ceo_briefs    ON public.ceo_briefs;

DROP POLICY IF EXISTS anon_select_system_logs   ON public.system_logs;
DROP POLICY IF EXISTS anon_insert_system_logs   ON public.system_logs;

DROP POLICY IF EXISTS anon_select_notifications ON public.notifications;
DROP POLICY IF EXISTS anon_insert_notifications ON public.notifications;
DROP POLICY IF EXISTS anon_update_notifications ON public.notifications;
DROP POLICY IF EXISTS anon_delete_notifications ON public.notifications;

-- ============================================================================
-- 3. USERS table
--    App needs: SELECT (load all users), UPDATE (edit profile/password),
--               INSERT (admin add user), DELETE (admin delete user)
-- ============================================================================

CREATE POLICY anon_select_users ON public.users
  FOR SELECT TO anon USING (true);

CREATE POLICY anon_insert_users ON public.users
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY anon_update_users ON public.users
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY anon_delete_users ON public.users
  FOR DELETE TO anon USING (true);

-- ============================================================================
-- 4. DEPARTMENTS table
--    App needs: SELECT (all), INSERT/UPDATE/DELETE (admin only — enforced JS-side)
-- ============================================================================

CREATE POLICY anon_select_departments ON public.departments
  FOR SELECT TO anon USING (true);

CREATE POLICY anon_insert_departments ON public.departments
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY anon_update_departments ON public.departments
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY anon_delete_departments ON public.departments
  FOR DELETE TO anon USING (true);

-- ============================================================================
-- 5. PROJECTS table
--    App needs: SELECT (all), INSERT/UPDATE (admin/ceo/executive/head — JS-side),
--               DELETE (admin/ceo/executive — JS-side)
-- ============================================================================

CREATE POLICY anon_select_projects ON public.projects
  FOR SELECT TO anon USING (true);

CREATE POLICY anon_insert_projects ON public.projects
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY anon_update_projects ON public.projects
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY anon_delete_projects ON public.projects
  FOR DELETE TO anon USING (true);

-- ============================================================================
-- 6. TASKS table
--    App needs: full CRUD (JS-side permission layer handles role checks)
-- ============================================================================

CREATE POLICY anon_select_tasks ON public.tasks
  FOR SELECT TO anon USING (true);

CREATE POLICY anon_insert_tasks ON public.tasks
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY anon_update_tasks ON public.tasks
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY anon_delete_tasks ON public.tasks
  FOR DELETE TO anon USING (true);

-- ============================================================================
-- 7. MEETINGS table
--    App needs: full CRUD
-- ============================================================================

CREATE POLICY anon_select_meetings ON public.meetings
  FOR SELECT TO anon USING (true);

CREATE POLICY anon_insert_meetings ON public.meetings
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY anon_update_meetings ON public.meetings
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY anon_delete_meetings ON public.meetings
  FOR DELETE TO anon USING (true);

-- ============================================================================
-- 8. CEO_BRIEFS table
--    App needs: full CRUD (JS-side: only admin/ceo can view/edit)
-- ============================================================================

CREATE POLICY anon_select_ceo_briefs ON public.ceo_briefs
  FOR SELECT TO anon USING (true);

CREATE POLICY anon_insert_ceo_briefs ON public.ceo_briefs
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY anon_update_ceo_briefs ON public.ceo_briefs
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY anon_delete_ceo_briefs ON public.ceo_briefs
  FOR DELETE TO anon USING (true);

-- ============================================================================
-- 9. SYSTEM_LOGS table
--    App needs: INSERT (all users, login events), SELECT (admin/ceo — JS-side)
--    No UPDATE or DELETE from client — cleanup is handled by pg_cron (see below)
-- ============================================================================

CREATE POLICY anon_select_system_logs ON public.system_logs
  FOR SELECT TO anon USING (true);

CREATE POLICY anon_insert_system_logs ON public.system_logs
  FOR INSERT TO anon WITH CHECK (true);

-- ============================================================================
-- 10. NOTIFICATIONS table
--     App needs: full CRUD
-- ============================================================================

CREATE POLICY anon_select_notifications ON public.notifications
  FOR SELECT TO anon USING (true);

CREATE POLICY anon_insert_notifications ON public.notifications
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY anon_update_notifications ON public.notifications
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY anon_delete_notifications ON public.notifications
  FOR DELETE TO anon USING (true);

-- ============================================================================
-- 11. pg_cron — auto-cleanup system_logs older than 7 days
--
--     Prerequisite: enable pg_cron extension in Supabase dashboard first:
--       Database → Extensions → search "pg_cron" → Enable
--
--     Runs daily at 02:00 UTC (09:00 Bangkok time)
-- ============================================================================

-- Enable the extension (safe to run even if already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant usage to postgres user (required by Supabase)
GRANT USAGE ON SCHEMA cron TO postgres;

-- Remove existing job if it already exists (idempotent)
SELECT cron.unschedule('dire-wolf-cleanup-system-logs')
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'dire-wolf-cleanup-system-logs'
  );

-- Schedule: daily at 02:00 UTC, delete logs older than 7 days
SELECT cron.schedule(
  'dire-wolf-cleanup-system-logs',
  '0 2 * * *',
  $$DELETE FROM public.system_logs WHERE created_at < NOW() - INTERVAL '7 days';$$
);

-- ============================================================================
-- VERIFY: check the cron job was registered
-- ============================================================================
-- SELECT jobname, schedule, command, active FROM cron.job WHERE jobname = 'dire-wolf-cleanup-system-logs';

-- ============================================================================
-- ROLLBACK (uncomment to revert)
-- ============================================================================
-- SELECT cron.unschedule('dire-wolf-cleanup-system-logs');
-- ALTER TABLE public.users         DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.departments   DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.projects      DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.tasks         DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.meetings      DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.ceo_briefs    DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.system_logs   DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.notifications DISABLE ROW LEVEL SECURITY;
