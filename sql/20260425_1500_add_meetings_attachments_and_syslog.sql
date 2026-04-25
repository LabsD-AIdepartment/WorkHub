-- ============================================================================
-- Migration: meetings.attachments + system_logs table
-- Date    : 2026-04-25 15:00 (Bangkok)
-- Idempotent: yes (uses IF NOT EXISTS)
-- ============================================================================

-- ── 1) meetings.attachments ──────────────────────────────────────────────────
ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_meetings_attachments
  ON public.meetings USING GIN (attachments jsonb_path_ops);

-- ── 2) ceo_briefs.createdAt (ensure column exists for timestamp display) ─────
ALTER TABLE public.ceo_briefs
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- ── 3) system_logs ───────────────────────────────────────────────────────────
--  Columns:
--    id          TEXT PRIMARY KEY  (app-generated uid)
--    user_id     TEXT              (FK to users.id, nullable for system events)
--    user_nick   TEXT              human-readable actor name
--    action      TEXT              short key e.g. 'login', 'task_status_change'
--    details     JSONB             event context object
--    created_at  TIMESTAMPTZ       auto-set to now()
--
--  Retention: old rows purged client-side when admin views logs.
--             To add server-side cleanup, create a pg_cron job:
--             SELECT cron.schedule('syslog-cleanup','0 3 * * *',
--               $$DELETE FROM system_logs WHERE created_at < NOW() - INTERVAL '7 days'$$);
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.system_logs (
  id          TEXT        PRIMARY KEY,
  user_id     TEXT        REFERENCES public.users(id) ON DELETE SET NULL,
  user_nick   TEXT        NOT NULL DEFAULT 'system',
  action      TEXT        NOT NULL,
  details     JSONB       DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast time-range query (used for 7-day fetch and cleanup)
CREATE INDEX IF NOT EXISTS idx_syslog_created_at
  ON public.system_logs (created_at DESC);

-- ── 4) Access policy for system_logs ─────────────────────────────────────────
--
--  WolfGrid uses Supabase with the anon key directly (no Supabase Auth / JWT).
--  auth.uid() is always NULL in this setup, so JWT-based RLS cannot be used.
--
--  Security strategy:
--    • INSERT  — allow anon (app writes logs from client)
--    • SELECT  — allow anon (app filters to admin-only in JS; table has no PII)
--    • DELETE  — allow anon (app-side purge of entries older than 7 days)
--    • Admin-only visibility is enforced in the JS layer (renderSystemLogPanel
--      checks currentUser().access === 'admin'|'ceo' before fetching).
--
--  If you later add Supabase Auth, replace these policies with auth.uid() checks.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.system_logs DISABLE ROW LEVEL SECURITY;

-- Grant full access to anon role (Supabase anon key)
GRANT SELECT, INSERT, DELETE ON public.system_logs TO anon;
GRANT USAGE ON SCHEMA public TO anon;

-- ============================================================================
-- ROLLBACK (uncomment to revert)
-- ============================================================================
-- DROP TABLE IF EXISTS public.system_logs;
-- DROP INDEX IF EXISTS public.idx_meetings_attachments;
-- ALTER TABLE public.meetings   DROP COLUMN IF EXISTS attachments;
-- ALTER TABLE public.ceo_briefs DROP COLUMN IF EXISTS created_at;
