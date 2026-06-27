#!/bin/bash
# Re-queue all failed jobs as pending. Use after a ChatGPT rate-limit cooldown.
# Resolves the DB the same way server/config.ts does (env-driven).
DB="${DARKROOM_DB:-${GALLERY_ROOT:-$HOME/Darkroom}/photos.db}"
sqlite3 "$DB" "UPDATE jobs SET status='pending', started_at=NULL, finished_at=NULL, error=NULL WHERE status='failed';"
echo "Re-queued. New summary:"
sqlite3 "$DB" "SELECT status, COUNT(*) FROM jobs GROUP BY status;"
