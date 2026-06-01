-- Migration 071: feedback approve-build workflow
-- Adds a nullable JSONB column to track the worktree/branch/prompt-file/commit
-- metadata created when Caleb clicks "Approve & build" on a feedback card.
-- Shape:
-- {
--   "worktree_path": "C:\\Users\\Caleb Lindsey\\Desktop\\callboard\\.claude\\worktrees\\feedback-7-fab-hidden",
--   "prompt_path":   "<worktree>/.claude/FEEDBACK_PROMPT.md",
--   "branch":        "feedback/7-fab-hidden",
--   "target_repo":   "callboard" | "compass",
--   "started_at":    "2026-05-13T20:45:00+00:00",
--   "completed_at":  null,
--   "commit_sha":    null
-- }

ALTER TABLE public.feedback_submissions
  ADD COLUMN IF NOT EXISTS build JSONB;

COMMENT ON COLUMN public.feedback_submissions.build IS
  'Set when "Approve & build" fires. Tracks worktree, branch, prompt file, and (after /ship) the resulting commit SHA. Null = no build kicked off yet.';
