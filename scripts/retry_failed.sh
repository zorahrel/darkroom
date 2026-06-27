#!/bin/bash
# Re-queue all failed jobs as pending. Use after ChatGPT rate limit cooldown.
sqlite3 ~/Pictures/Japan/photos.db "UPDATE jobs SET status='pending', started_at=NULL, finished_at=NULL, error=NULL WHERE status='failed';"
echo "Re-queued. New summary:"
sqlite3 ~/Pictures/Japan/photos.db "SELECT status, COUNT(*) FROM jobs GROUP BY status;"
