-- ============================================================================
-- Migration: Add `attachments` JSONB column to projects / tasks / ceo_briefs
-- Purpose : Persist file uploads (and their delete metadata) on each entity.
--           Each attachment object: {id, name, type, size, dataUrl, uploadedBy,
--           createdAt, deletedAt?, deletedBy?}.
-- Date    : 2026-04-25 12:30 (Bangkok)
-- Related : Fix #4 - "Delete uploaded files (admin/uploader only)"
-- Idempotent: yes (uses IF NOT EXISTS)
-- ============================================================================

-- 1) projects.attachments
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

-- 2) tasks.attachments
--    Comment attachments live INSIDE tasks.comments JSON (no separate column).
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

-- 3) ceo_briefs.attachments
ALTER TABLE public.ceo_briefs
  ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

-- 4) Optional: indexes for fast attachment lookup (size of cards, etc.)
--    These are jsonb_path_ops indexes — small, very fast for "has key X" type queries.
CREATE INDEX IF NOT EXISTS idx_projects_attachments ON public.projects USING GIN (attachments jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_tasks_attachments    ON public.tasks    USING GIN (attachments jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_briefs_attachments   ON public.ceo_briefs USING GIN (attachments jsonb_path_ops);

-- ============================================================================
-- ROLLBACK (uncomment to revert)
-- ============================================================================
-- DROP INDEX IF EXISTS public.idx_projects_attachments;
-- DROP INDEX IF EXISTS public.idx_tasks_attachments;
-- DROP INDEX IF EXISTS public.idx_briefs_attachments;
-- ALTER TABLE public.projects   DROP COLUMN IF EXISTS attachments;
-- ALTER TABLE public.tasks      DROP COLUMN IF EXISTS attachments;
-- ALTER TABLE public.ceo_briefs DROP COLUMN IF EXISTS attachments;
