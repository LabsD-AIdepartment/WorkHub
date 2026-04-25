-- ============================================================================
-- Migration: projects.start_date
-- Date    : 2026-04-25 18:00 (Bangkok)
-- Idempotent: yes (uses IF NOT EXISTS)
-- Purpose : Store project start date so Sprint Timeline can anchor correctly
--           and not default to today. Without this column the Gantt/sprint
--           chart always pins the left edge to today instead of the project
--           start, making short projects look mis-aligned.
-- ============================================================================

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS start_date DATE;

-- Optional index (useful if you later query projects by date range)
CREATE INDEX IF NOT EXISTS idx_projects_start_date
  ON public.projects (start_date);

-- ============================================================================
-- ROLLBACK (uncomment to revert)
-- ============================================================================
-- DROP INDEX IF EXISTS public.idx_projects_start_date;
-- ALTER TABLE public.projects DROP COLUMN IF EXISTS start_date;
