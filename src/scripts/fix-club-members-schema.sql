-- SQL script to add missing updated_at column to club_members table
-- This fixes the "SQLITE_ERROR: no such column: updated_at" error in clubmod command

-- Step 1: Add the column with NULL default (SQLite doesn't allow non-constant defaults)
ALTER TABLE club_members ADD COLUMN updated_at INTEGER;

-- Step 2: Update existing rows to set the current timestamp
UPDATE club_members SET updated_at = strftime('%s', 'now') WHERE updated_at IS NULL;
