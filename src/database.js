// src/database.js
import sqlite3 from 'sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from './utils/debug.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, '../bot.db');

let db;

/**
 * Initializes the SQLite database
 */
async function initializeDatabase() {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
            if (err) {
                log('Error connecting to database:', 'error', null, err, 'error');
                return reject(err);
            }
            log('Connected to the SQLite database.', 'init');

            db.serialize(() => {
                // ==================== CORE TABLES ====================

                createGuildConfigsTable();
                createReactionRolesTable();
                createSuggestionsTable();
                createUserStatsTable();
                createBirthdaysTable();
                createWarningsTable();
                createVerifiedUsersTable();
                createActiveVoiceSessionsTable();
                createNoticesTable();
                createAntiSpamConfigsTable();
                createFaqsTable();
                createAdminTasksTable();
                createModerationActionsTable();
                createReputationTable();
                createModCooldownsTable();

                // ==================== CLUB TABLES ====================

                createClubsTable();
                createClubMembersTable();
                createClubJoinRequestsTable();
                fixClubJoinRequestsSchema();
                createClubEventsTableWithMigration();
                createEventParticipantsTable();
                ensureEventParticipantsColumns();
                createEventRegistrationsTable();
                createEventEligibilityRolesTable();
                migrateClubEventsVisibilityColumns();
                migrateClubEventsPaymentColumns();
                createClubAnnouncementsTable();
                createClubAuditLogTable();
                createClubResourcesTable();
                createClubSettingsTable();

                // ==================== INDEXES & VIEWS ====================

                createClubIndexes();
                createClubTriggers();
                createClubViews();

                log('Database initialization complete.', 'init');
                log('All database tables checked/created and schema updated.', 'init');
                resolve(db);
            });
        });
    });
}

// ==================== CORE TABLE CREATORS ====================

function createGuildConfigsTable() {
    db.run(`CREATE TABLE IF NOT EXISTS guild_configs (
        guild_id TEXT PRIMARY KEY,
        welcome_message_content TEXT,
        welcome_channel_id TEXT,
        send_welcome_as_dm BOOLEAN DEFAULT 0,
        farewell_channel_id TEXT,
        rep_deduction_per_warn INTEGER DEFAULT 10,
        rep_lockout_duration_ms INTEGER DEFAULT 86400000,
        rep_to_clear_warn INTEGER DEFAULT 20,
        UNIQUE(guild_id) ON CONFLICT REPLACE
    )`, (err) => {
        if (err) log('Error creating guild_configs:', 'error', null, err, 'error');
        else log('✓ guild_configs', 'init');
    });

    migrateTable('guild_configs', [
        { name: "farewell_channel_id", type: "TEXT", defaultValue: "NULL" },
        { name: "rep_deduction_per_warn", type: "INTEGER", defaultValue: 10 },
        { name: "rep_lockout_duration_ms", type: "INTEGER", defaultValue: 86400000 },
        { name: "rep_to_clear_warn", type: "INTEGER", defaultValue: 20 }
    ]);
}

function createReactionRolesTable() {
    db.run(`CREATE TABLE IF NOT EXISTS reaction_roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        emoji TEXT NOT NULL,
        role_id TEXT NOT NULL,
        UNIQUE(message_id, emoji, guild_id) ON CONFLICT REPLACE
    )`, (err) => {
        if (err) log('Error creating reaction_roles:', 'error', null, err, 'error');
        else log('✓ reaction_roles', 'init');
    });
}

function createSuggestionsTable() {
    db.run(`CREATE TABLE IF NOT EXISTS suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        message_id TEXT,
        suggestion_text TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        submitted_at INTEGER NOT NULL,
        reviewed_by TEXT,
        reviewed_at INTEGER,
        reason TEXT,
        upvotes INTEGER DEFAULT 0,
        downvotes INTEGER DEFAULT 0
    )`, (err) => {
        if (err) log('Error creating suggestions:', 'error', null, err, 'error');
        else log('✓ suggestions', 'init');
    });
}

function createUserStatsTable() {
    db.run(`CREATE TABLE IF NOT EXISTS user_stats (
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        messages_sent INTEGER DEFAULT 0,
        voice_time_minutes REAL DEFAULT 0.0,
        last_message_at INTEGER,
        reputation_lockout_until INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, guild_id)
    )`, (err) => {
        if (err) log('Error creating user_stats:', 'error', null, err, 'error');
        else log('✓ user_stats', 'init');
    });

    migrateTable('user_stats', [
        { name: "reputation_lockout_until", type: "INTEGER", defaultValue: 0 }
    ]);
}

function createBirthdaysTable() {
    db.run(`CREATE TABLE IF NOT EXISTS birthdays (
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        month INTEGER NOT NULL,
        day INTEGER NOT NULL,
        year INTEGER,
        set_by TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, guild_id)
    )`, (err) => {
        if (err) log('Error creating birthdays:', 'error', null, err, 'error');
        else log('✓ birthdays', 'init');
    });
}

function createWarningsTable() {
    db.run(`CREATE TABLE IF NOT EXISTS warnings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT NOT NULL,
        guildId TEXT NOT NULL,
        moderatorId TEXT NOT NULL,
        reason TEXT,
        timestamp INTEGER
    )`, (err) => {
        if (err) log('Error creating warnings:', 'error', null, err, 'error');
        else log('✓ warnings', 'init');
    });
}

function createVerifiedUsersTable() {
    db.run(`CREATE TABLE IF NOT EXISTS verified_users (
        user_id TEXT NOT NULL PRIMARY KEY,
        guild_id TEXT NOT NULL,
        real_name TEXT NOT NULL,
        discord_username TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        verified_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) log('Error creating verified_users:', 'error', null, err, 'error');
        else log('✓ verified_users', 'init');
    });
}

function createActiveVoiceSessionsTable() {
    db.run(`CREATE TABLE IF NOT EXISTS active_voice_sessions (
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        join_time INTEGER NOT NULL,
        PRIMARY KEY (user_id, guild_id)
    )`, (err) => {
        if (err) log('Error creating active_voice_sessions:', 'error', null, err, 'error');
        else log('✓ active_voice_sessions', 'init');
    });
}

function createNoticesTable() {
    db.run(`CREATE TABLE IF NOT EXISTS notices (
        title TEXT NOT NULL,
        link TEXT NOT NULL,
        date TEXT NOT NULL,
        announced_at INTEGER NOT NULL,
        PRIMARY KEY (link)
    )`, (err) => {
        if (err) log('Error creating notices:', 'error', null, err, 'error');
        else log('✓ notices', 'init');
    });
}

function createAntiSpamConfigsTable() {
    db.run(`CREATE TABLE IF NOT EXISTS anti_spam_configs (
        guild_id TEXT PRIMARY KEY,
        message_limit INTEGER DEFAULT 5,
        time_window_seconds INTEGER DEFAULT 5,
        mute_duration_seconds INTEGER DEFAULT 300,
        kick_threshold INTEGER DEFAULT 3,
        ban_threshold INTEGER DEFAULT 5,
        UNIQUE(guild_id) ON CONFLICT REPLACE
    )`, (err) => {
        if (err) log('Error creating anti_spam_configs:', 'error', null, err, 'error');
        else log('✓ anti_spam_configs', 'init');
    });

    migrateTable('anti_spam_configs', [
        { name: "message_limit", type: "INTEGER", defaultValue: 5 },
        { name: "time_window_seconds", type: "INTEGER", defaultValue: 5 },
        { name: "mute_duration_seconds", type: "INTEGER", defaultValue: 300 },
        { name: "kick_threshold", type: "INTEGER", defaultValue: 3 },
        { name: "ban_threshold", type: "INTEGER", defaultValue: 5 }
    ]);
}

function createFaqsTable() {
    db.run(`CREATE TABLE IF NOT EXISTS faqs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        keywords TEXT,
        created_by TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(guild_id, question)
    )`, (err) => {
        if (err) log('Error creating faqs:', 'error', null, err, 'error');
        else log('✓ faqs', 'init');
    });

    migrateTable('faqs', [
        { name: "keywords", type: "TEXT", defaultValue: "NULL" },
        { name: "created_by", type: "TEXT", defaultValue: "NULL" }
    ]);
}

function createAdminTasksTable() {
    db.run(`CREATE TABLE IF NOT EXISTS admin_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        creatorId TEXT NOT NULL,
        taskDescription TEXT,
        description TEXT, 
        assigned_to TEXT,
        status TEXT DEFAULT 'pending',
        createdAt INTEGER,
        due_date DATETIME
    )`, (err) => {
        if (err) log('Error creating admin_tasks:', 'error', null, err, 'error');
        else log('✓ admin_tasks', 'init');
    });

    migrateTable('admin_tasks', [
        { name: "creatorId", type: "TEXT", defaultValue: "NULL" },
        { name: "taskDescription", type: "TEXT", defaultValue: "NULL" },
        { name: "createdAt", type: "INTEGER", defaultValue: "NULL" }
    ]);
}



function createModerationActionsTable() {
    db.run(`CREATE TABLE IF NOT EXISTS moderation_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action_type TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        target_user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        reason TEXT
    )`, (err) => {
        if (err) log('Error creating moderation_actions:', 'error', null, err, 'error');
        else log('✓ moderation_actions', 'init');
    });
}

function createReputationTable() {
    db.run(`CREATE TABLE IF NOT EXISTS reputation (
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        reputation_points INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, guild_id)
    )`, (err) => {
        if (err) log('Error creating reputation:', 'error', null, err, 'error');
        else log('✓ reputation', 'init');
    });
}

function createModCooldownsTable() {
    db.run(`CREATE TABLE IF NOT EXISTS mod_cooldowns (
        command_name TEXT NOT NULL,
        user_id TEXT NOT NULL,
        last_used_at INTEGER NOT NULL,
        PRIMARY KEY (command_name, user_id)
    )`, (err) => {
        if (err) log('Error creating mod_cooldowns:', 'error', null, err, 'error');
        else log('✓ mod_cooldowns', 'init');
    });
}

// ==================== CLUB TABLE CREATORS ====================

function createClubsTable() {
    db.run(`CREATE TABLE IF NOT EXISTS clubs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        description TEXT NOT NULL,
        logo_url TEXT,
        president_user_id TEXT NOT NULL,
        role_id TEXT,
        moderator_role_id TEXT,
        channel_id TEXT,
        voice_channel_id TEXT,
        category_id TEXT,
        category TEXT DEFAULT 'general',
        advisor_name TEXT,
        contact_email TEXT,
        contact_phone TEXT,
        website_url TEXT,
        social_media TEXT,
        max_members INTEGER DEFAULT 100,
        require_approval BOOLEAN DEFAULT 1,
        is_public BOOLEAN DEFAULT 1,
        status TEXT DEFAULT 'pending',
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        approved_at INTEGER,
        approved_by TEXT,
        UNIQUE(guild_id, name),
        UNIQUE(guild_id, slug),
        CHECK(status IN ('pending', 'active', 'inactive', 'suspended', 'archived')),
        CHECK(category IN ('technical', 'cultural', 'sports', 'social_service', 'academic', 'general'))
    )`, (err) => {
        if (err) log('Error creating clubs:', 'error', null, err, 'error');
        else log('✓ clubs', 'init');
    });

    migrateTable('clubs', [
        { name: "slug", type: "TEXT", defaultValue: "NULL" },
        { name: "moderator_role_id", type: "TEXT", defaultValue: "NULL" },
        { name: "category_id", type: "TEXT", defaultValue: "NULL" },
        { name: "contact_email", type: "TEXT", defaultValue: "NULL" },
        { name: "contact_phone", type: "TEXT", defaultValue: "NULL" },
        { name: "website_url", type: "TEXT", defaultValue: "NULL" },
        { name: "social_media", type: "TEXT", defaultValue: "NULL" },
        { name: "require_approval", type: "BOOLEAN", defaultValue: 1 },
        { name: "is_public", type: "BOOLEAN", defaultValue: 1 },
        { name: "created_at", type: "INTEGER", defaultValue: "(strftime('%s', 'now'))" },
        { name: "updated_at", type: "INTEGER", defaultValue: "(strftime('%s', 'now'))" },
        { name: "approved_at", type: "INTEGER", defaultValue: "NULL" },
        { name: "approved_by", type: "TEXT", defaultValue: "NULL" },
        { name: "private_event_channel_id", type: "TEXT", defaultValue: "NULL" }
    ]);

    // Generate slugs for existing clubs
    db.all("PRAGMA table_info(clubs)", (err, columns) => {
        if (err) return;
        const hasSlug = columns.some(col => col.name === 'slug');
        if (hasSlug) {
            db.all(`SELECT id, name FROM clubs WHERE slug IS NULL`, [], (err, rows) => {
                if (!err && rows && rows.length > 0) {
                    rows.forEach(club => {
                        const slug = generateSlug(club.name);
                        db.run(`UPDATE clubs SET slug = ? WHERE id = ?`, [slug, club.id]);
                    });
                }
            });
        }
    });
}

function createClubMembersTable() {
    db.run(`CREATE TABLE IF NOT EXISTS club_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        club_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        role TEXT DEFAULT 'member',
        joined_at INTEGER DEFAULT (strftime('%s', 'now')),
        last_active_at INTEGER,
        attendance_count INTEGER DEFAULT 0,
        contribution_points INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        removed_at INTEGER,
        removed_by TEXT,
        removal_reason TEXT,
        FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE,
        UNIQUE(club_id, user_id),
        CHECK(role IN ('member', 'moderator', 'president')),
        CHECK(status IN ('active', 'inactive', 'removed', 'banned'))
    )`, (err) => {
        if (err) log('Error creating club_members:', 'error', null, err, 'error');
        else log('✓ club_members', 'init');
    });

    migrateTable('club_members', [
        { name: "last_active_at", type: "INTEGER", defaultValue: "NULL" },
        { name: "updated_at", type: "INTEGER", defaultValue: "(strftime('%s', 'now'))" },
        { name: "removed_at", type: "INTEGER", defaultValue: "NULL" },
        { name: "removed_by", type: "TEXT", defaultValue: "NULL" },
        { name: "removal_reason", type: "TEXT", defaultValue: "NULL" }
    ]);
}

function createClubJoinRequestsTable() {
    db.run(`CREATE TABLE IF NOT EXISTS club_join_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        club_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        full_name TEXT NOT NULL,
        email TEXT,
        interest_reason TEXT NOT NULL,
        experience TEXT,
        expectations TEXT,
        status TEXT DEFAULT 'pending',
        reviewed_by TEXT,
        reviewed_at INTEGER,
        rejection_reason TEXT,
        requested_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE,
        CHECK(status IN ('pending', 'approved', 'rejected', 'withdrawn'))
    )`, (err) => {
        if (err) log('Error creating club_join_requests:', 'error', null, err, 'error');
        else log('✓ club_join_requests', 'init');
    });

    migrateTable('club_join_requests', [
        { name: "email", type: "TEXT", defaultValue: "NULL" },
        { name: "experience", type: "TEXT", defaultValue: "NULL" },
        { name: "expectations", type: "TEXT", defaultValue: "NULL" },
        { name: "rejection_reason", type: "TEXT", defaultValue: "NULL" },
        { name: "updated_at", type: "INTEGER", defaultValue: "(strftime('%s', 'now'))" }
    ]);
}

/**
 * Fix and validate club_join_requests schema
 * Removes legacy columns and ensures all required columns exist
 */
function fixClubJoinRequestsSchema() {
    db.all("PRAGMA table_info(club_join_requests)", (err, columns) => {
        if (err) {
            log('Error checking club_join_requests schema:', 'error', null, err, 'error');
            return;
        }

        const columnNames = columns ? columns.map(col => col.name) : [];

        const legacyColumns = ['interest_confirmed', 'reason'];
        const foundLegacy = legacyColumns.filter(col => columnNames.includes(col));

        if (foundLegacy.length > 0) {
            log(`⚠️ Found legacy columns in club_join_requests: ${foundLegacy.join(', ')}`, 'init', null, null, 'warn');
            log('🔧 Recreating table with correct schema...', 'init', null, null, 'warn');

            db.serialize(() => {
                db.run(`ALTER TABLE club_join_requests RENAME TO club_join_requests_old`, (renameErr) => {
                    if (renameErr) {
                        log('Error renaming old table:', 'error', null, renameErr, 'error');
                        return;
                    }
                    db.run(`CREATE TABLE club_join_requests (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        club_id INTEGER NOT NULL,
                        user_id TEXT NOT NULL,
                        guild_id TEXT NOT NULL,
                        full_name TEXT NOT NULL,
                        email TEXT,
                        interest_reason TEXT NOT NULL,
                        experience TEXT,
                        expectations TEXT,
                        status TEXT DEFAULT 'pending',
                        reviewed_by TEXT,
                        reviewed_at INTEGER,
                        rejection_reason TEXT,
                        requested_at INTEGER DEFAULT (strftime('%s', 'now')),
                        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
                        FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE,
                        CHECK(status IN ('pending', 'approved', 'rejected', 'withdrawn'))
                    )`, (createErr) => {
                        if (createErr) {
                            log('Error creating new table:', 'error', null, createErr, 'error');
                            return;
                        }

                        const copyQuery = columnNames.includes('interest_reason')
                            ? `INSERT INTO club_join_requests 
                               (id, club_id, user_id, guild_id, full_name, email, interest_reason, 
                                experience, expectations, status, reviewed_by, reviewed_at, 
                                rejection_reason, requested_at, updated_at)
                               SELECT id, club_id, user_id, 
                                      COALESCE(guild_id, ''), 
                                      full_name, email, interest_reason,
                                      experience, expectations, status, reviewed_by, reviewed_at,
                                      rejection_reason, requested_at, updated_at
                               FROM club_join_requests_old`
                            : `INSERT INTO club_join_requests 
                               (id, club_id, user_id, guild_id, full_name, email, interest_reason, 
                                experience, expectations, status, reviewed_by, reviewed_at, 
                                rejection_reason, requested_at, updated_at)
                               SELECT id, club_id, user_id, 
                                      COALESCE(guild_id, ''), 
                                      full_name, email, 
                                      COALESCE(reason, 'No reason provided'),
                                      experience, expectations, status, reviewed_by, reviewed_at,
                                      rejection_reason, requested_at, updated_at
                               FROM club_join_requests_old`;

                        db.run(copyQuery, (copyErr) => {
                            if (copyErr) {
                                log('Error copying data:', 'error', null, copyErr, 'error');
                                db.run(`DROP TABLE IF EXISTS club_join_requests`);
                                db.run(`ALTER TABLE club_join_requests_old RENAME TO club_join_requests`);
                                return;
                            }

                            db.run(`DROP TABLE club_join_requests_old`, (dropErr) => {
                                if (dropErr) {
                                    log('Error dropping old table:', 'error', null, dropErr, 'error');
                                } else {
                                    log('✅ Successfully migrated club_join_requests schema', 'init', null, null, 'success');
                                    log(`   Removed legacy columns: ${foundLegacy.join(', ')}`, 'init', null, null, 'success');
                                }
                            });
                        });
                    });
                });
            });

            return;
        }

        const requiredColumns = [
            { name: 'guild_id', type: 'TEXT NOT NULL', defaultValue: "''", needsPopulate: true },
            { name: 'full_name', type: 'TEXT NOT NULL', defaultValue: "''", needsPopulate: false },
            { name: 'interest_reason', type: 'TEXT NOT NULL', defaultValue: "''", needsPopulate: false },
            { name: 'email', type: 'TEXT', defaultValue: 'NULL', needsPopulate: false },
            { name: 'experience', type: 'TEXT', defaultValue: 'NULL', needsPopulate: false },
            { name: 'expectations', type: 'TEXT', defaultValue: 'NULL', needsPopulate: false },
            { name: 'status', type: 'TEXT', defaultValue: "'pending'", needsPopulate: false },
            { name: 'reviewed_by', type: 'TEXT', defaultValue: 'NULL', needsPopulate: false },
            { name: 'reviewed_at', type: 'INTEGER', defaultValue: 'NULL', needsPopulate: false },
            { name: 'rejection_reason', type: 'TEXT', defaultValue: 'NULL', needsPopulate: false },
            { name: 'requested_at', type: 'INTEGER', defaultValue: "(strftime('%s', 'now'))", needsPopulate: false },
            { name: 'updated_at', type: 'INTEGER', defaultValue: "(strftime('%s', 'now'))", needsPopulate: false }
        ];

        let missingColumns = [];

        requiredColumns.forEach(col => {
            if (!columnNames.includes(col.name)) {
                missingColumns.push(col);
            }
        });

        if (missingColumns.length > 0) {
            log(`🔧 Adding ${missingColumns.length} missing columns to club_join_requests`, 'init', { columns: missingColumns.map(c => c.name) }, null, 'warn');

            missingColumns.forEach((col) => {
                db.run(`ALTER TABLE club_join_requests ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.defaultValue}`, (err) => {
                    if (err && !err.message.includes('duplicate')) {
                        log(`Error adding ${col.name} column:`, 'error', null, err, 'error');
                    } else {
                        log(`✅ Added ${col.name} column to club_join_requests`, 'init', null, null, 'success');

                        if (col.name === 'guild_id' && col.needsPopulate) {
                            db.run(`
                                UPDATE club_join_requests 
                                SET guild_id = (
                                    SELECT guild_id 
                                    FROM clubs 
                                    WHERE clubs.id = club_join_requests.club_id
                                )
                                WHERE guild_id = '' OR guild_id IS NULL
                            `, (updateErr) => {
                                if (updateErr) {
                                    log('Error populating guild_id:', 'error', null, updateErr, 'error');
                                } else {
                                    log('✅ Populated guild_id for existing join requests', 'init', null, null, 'success');
                                }
                            });
                        }
                    }
                });
            });
        } else {
            log('✓ club_join_requests schema is up to date', 'init');
        }
    });
}

function createClubEventsTableWithMigration() {
    db.all("PRAGMA table_info(club_events)", (err, columns) => {
        if (err || !columns || columns.length === 0) {
            createClubEventsTableFresh();
        } else {
            const columnNames = columns.map(col => col.name);
            const hasOldDate = columnNames.includes("date");
            const hasEventDate = columnNames.includes("event_date");

            if (hasOldDate && !hasEventDate) {
                log("🔧 Migrating club_events: date → event_date", 'init', null, null, 'warn');
                migrateClubEventsDateColumn();
            } else if (!hasEventDate) {
                log("⚠️ Recreating club_events with correct schema", 'init', null, null, 'warn');
                recreateClubEventsTable();
            } else {
                log('✓ club_events (correct schema)', 'init');
                migrateClubEventsColumns(columnNames);
            }
        }
    });
}

function createClubEventsTableFresh() {
    db.run(`CREATE TABLE IF NOT EXISTS club_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        club_id INTEGER NOT NULL,
        guild_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        event_type TEXT DEFAULT 'general',
        event_date TEXT NOT NULL,
        start_time TEXT,
        end_time TEXT,
        timezone TEXT DEFAULT 'UTC',
        location_type TEXT DEFAULT 'physical',
        venue TEXT,
        meeting_link TEXT,
        registration_required BOOLEAN DEFAULT 0,
        registration_deadline TEXT,
        max_participants INTEGER,
        min_participants INTEGER,
        registration_fee NUMERIC DEFAULT 0,
        external_form_url TEXT,
        eligibility_criteria TEXT,
        is_team_event BOOLEAN DEFAULT 0,
        team_size_min INTEGER,
        team_size_max INTEGER,
        require_team_captain BOOLEAN DEFAULT 0,
        poster_url TEXT,
        resources_links TEXT,
        status TEXT DEFAULT 'pending',
        visibility TEXT DEFAULT 'club',
        message_id TEXT,
        reminder_sent BOOLEAN DEFAULT 0,
        created_by TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        approved_by TEXT,
        approved_at INTEGER,
        cancelled_by TEXT,
        cancelled_at INTEGER,
        cancellation_reason TEXT,
        FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE,
        CHECK(event_type IN ('meeting', 'workshop', 'competition', 'social', 'seminar', 'recruitment', 'general')),
        CHECK(location_type IN ('physical', 'virtual', 'hybrid')),
        CHECK(status IN ('pending', 'approved', 'scheduled', 'ongoing', 'completed', 'cancelled', 'postponed')),
        CHECK(visibility IN ('club', 'guild', 'public'))
    )`, (err) => {
        if (err) log('Error creating club_events:', 'error', null, err, 'error');
        else log('✓ club_events (fresh)', 'init');
    });
}

function migrateClubEventsDateColumn() {
    db.serialize(() => {
        db.get("SELECT COUNT(*) as count FROM club_events", [], (err, row) => {
            const count = row?.count || 0;

            if (count > 0) {
                log(`📦 Backing up ${count} events...`, 'init');
                db.run(`CREATE TABLE club_events_backup AS SELECT * FROM club_events`, () => {
                    db.run(`DROP TABLE club_events`, () => {
                        createClubEventsTableFresh();
                        setTimeout(() => {
                            db.run(`
                                INSERT INTO club_events (id, club_id, guild_id, title, description, event_type,
                                    event_date, start_time, end_time, venue, max_participants, status,
                                    created_by, created_at, updated_at, approved_by, approved_at, message_id)
                                SELECT id, club_id, guild_id, title, description, COALESCE(event_type, 'general'),
                                    COALESCE(date, '2025-01-01'), start_time, end_time, venue, max_participants, status,
                                    created_by, created_at, updated_at, approved_by, approved_at, message_id
                                FROM club_events_backup
                            `, (err) => {
                                if (err) log('Migration error:', 'error', null, err, 'error');
                                else log(`✅ Migrated ${count} events`, 'init', null, null, 'success');
                            });
                        }, 100);
                    });
                });
            } else {
                recreateClubEventsTable();
            }
        });
    });
}

function recreateClubEventsTable() {
    db.run(`DROP TABLE IF EXISTS club_events`, () => {
        createClubEventsTableFresh();
    });
}

function migrateClubEventsColumns(existingColumns) {
    const columns = [
        { name: "timezone", type: "TEXT", defaultValue: "'UTC'" },
        { name: "location_type", type: "TEXT", defaultValue: "'physical'" },
        { name: "meeting_link", type: "TEXT", defaultValue: "NULL" },
        { name: "registration_required", type: "BOOLEAN", defaultValue: 0 },
        { name: "registration_deadline", type: "TEXT", defaultValue: "NULL" },
        { name: "min_participants", type: "INTEGER", defaultValue: "NULL" },
        { name: "registration_fee", type: "NUMERIC", defaultValue: 0 },
        { name: "external_form_url", type: "TEXT", defaultValue: "NULL" },
        { name: "eligibility_criteria", type: "TEXT", defaultValue: "NULL" },
        { name: "is_team_event", type: "BOOLEAN", defaultValue: 0 },
        { name: "team_size_min", type: "INTEGER", defaultValue: "NULL" },
        { name: "team_size_max", type: "INTEGER", defaultValue: "NULL" },
        { name: "require_team_captain", type: "BOOLEAN", defaultValue: 0 },
        { name: "poster_url", type: "TEXT", defaultValue: "NULL" },
        { name: "resources_links", type: "TEXT", defaultValue: "NULL" },
        { name: "visibility", type: "TEXT", defaultValue: "'club'" },
        { name: "reminder_sent", type: "BOOLEAN", defaultValue: 0 },
        { name: "cancelled_by", type: "TEXT", defaultValue: "NULL" },
        { name: "cancelled_at", type: "INTEGER", defaultValue: "NULL" },
        { name: "cancellation_reason", type: "TEXT", defaultValue: "NULL" }
    ];

    columns.forEach(col => {
        if (!existingColumns.includes(col.name)) {
            db.run(`ALTER TABLE club_events ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.defaultValue}`, (err) => {
                if (err && !err.message.includes('duplicate')) {
                    log(`Error adding ${col.name}:`, 'error', null, err, 'error');
                }
            });
        }
    });
}


function createEventParticipantsTable() {
    db.run(`CREATE TABLE IF NOT EXISTS event_participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        team_name TEXT,
        team_id TEXT,
        team_captain_id TEXT,
        is_team_captain BOOLEAN DEFAULT 0,
        registration_data TEXT,
        registration_date INTEGER DEFAULT (strftime('%s', 'now')),
        rsvp_status TEXT DEFAULT 'going',
        checked_in BOOLEAN DEFAULT 0,
        checked_in_at INTEGER,
        attendance_confirmed BOOLEAN DEFAULT 0,
        rating INTEGER,
        feedback TEXT,
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (event_id) REFERENCES club_events(id) ON DELETE CASCADE,
        UNIQUE(event_id, user_id),
        CHECK(rsvp_status IN ('going', 'maybe', 'not_going')),
        CHECK(rating BETWEEN 1 AND 5 OR rating IS NULL)
    )`, (err) => {
        if (err) log('Error creating event_participants:', 'error', null, err, 'error');
        else log('✓ event_participants', 'init');
    });

    migrateTable('event_participants', [
        { name: "team_id", type: "TEXT", defaultValue: "NULL" },
        { name: "registration_date", type: "INTEGER", defaultValue: "(strftime('%s', 'now'))" },
        { name: "rsvp_status", type: "TEXT", defaultValue: "'going'" },
        { name: "checked_in", type: "BOOLEAN", defaultValue: 0 },
        { name: "checked_in_at", type: "INTEGER", defaultValue: "NULL" },
        { name: "attendance_confirmed", type: "BOOLEAN", defaultValue: 0 },
        { name: "rating", type: "INTEGER", defaultValue: "NULL" },
        { name: "feedback", type: "TEXT", defaultValue: "NULL" },
        { name: "updated_at", type: "INTEGER", defaultValue: "(strftime('%s', 'now'))" }
    ]);
}


/**
 * Ensure event_participants has all required columns
 */
function ensureEventParticipantsColumns() {
    db.all("PRAGMA table_info(event_participants)", (err, columns) => {
        if (err) {
            log('Error checking event_participants schema:', 'error', null, err, 'error');
            return;
        }

        const existingColumns = columns ? columns.map(col => col.name) : [];

        if (!existingColumns.includes('guild_id')) {
            log('Adding missing guild_id column to event_participants', 'init', null, null, 'warn');
            db.run(`ALTER TABLE event_participants ADD COLUMN guild_id TEXT NOT NULL DEFAULT ''`, (err) => {
                if (err && !err.message.includes('duplicate')) {
                    log('Error adding guild_id column:', 'error', null, err, 'error');
                } else {
                    log('✅ Added guild_id column to event_participants', 'init');
                }
            });
        }

        const requiredColumns = [
            { name: 'team_name', type: 'TEXT', defaultValue: 'NULL' },
            { name: 'team_id', type: 'TEXT', defaultValue: 'NULL' },
            { name: 'team_captain_id', type: 'TEXT', defaultValue: 'NULL' },
            { name: 'is_team_captain', type: 'BOOLEAN', defaultValue: 0 },
            { name: 'registration_data', type: 'TEXT', defaultValue: 'NULL' },
            { name: 'registration_date', type: 'INTEGER', defaultValue: "(strftime('%s', 'now'))" },
            { name: 'rsvp_status', type: 'TEXT', defaultValue: "'going'" },
            { name: 'checked_in', type: 'BOOLEAN', defaultValue: 0 },
            { name: 'checked_in_at', type: 'INTEGER', defaultValue: 'NULL' },
            { name: 'attendance_confirmed', type: 'BOOLEAN', defaultValue: 0 },
            { name: 'rating', type: 'INTEGER', defaultValue: 'NULL' },
            { name: 'feedback', type: 'TEXT', defaultValue: 'NULL' },
            { name: 'updated_at', type: 'INTEGER', defaultValue: "(strftime('%s', 'now'))" }
        ];

        requiredColumns.forEach(col => {
            if (!existingColumns.includes(col.name)) {
                const alterSQL = `ALTER TABLE event_participants ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.defaultValue}`;
                db.run(alterSQL, (err) => {
                    if (err && !err.message.includes('duplicate')) {
                        log(`Error adding ${col.name} column:`, 'error', null, err, 'error');
                    }
                });
            }
        });
    });
}

/**
 * Create event_registrations table for payment tracking
 */
function createEventRegistrationsTable() {
    db.run(`CREATE TABLE IF NOT EXISTS event_registrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        payment_proof_url TEXT,
        payment_status TEXT DEFAULT 'pending',
        payment_verified_by TEXT,
        payment_verified_at INTEGER,
        registration_notes TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (event_id) REFERENCES club_events(id) ON DELETE CASCADE,
        UNIQUE(event_id, user_id),
        CHECK(payment_status IN ('pending', 'verified', 'rejected'))
    )`, (err) => {
        if (err) log('Error creating event_registrations:', 'error', null, err, 'error');
        else log('✓ event_registrations', 'init');
    });
}

/**
 * Create event_eligibility_roles table for role-based event access control
 */
function createEventEligibilityRolesTable() {
    db.run(`CREATE TABLE IF NOT EXISTS event_eligibility_roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        role_id TEXT NOT NULL,
        role_type TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (event_id) REFERENCES club_events(id) ON DELETE CASCADE,
        CHECK(role_type IN ('faculty', 'batch', 'verified', 'guest', 'custom'))
    )`, (err) => {
        if (err) log('Error creating event_eligibility_roles:', 'error', null, err, 'error');
        else log('✓ event_eligibility_roles', 'init');
    });
}

/**
 * Migrate club_events table to add visibility and private channel columns
 */
function migrateClubEventsVisibilityColumns() {
    const columns = [
        { name: "event_visibility", type: "TEXT", defaultValue: "'public'" },
        { name: "private_channel_id", type: "TEXT", defaultValue: "NULL" }
    ];

    db.all("PRAGMA table_info(club_events)", (err, existingColumns) => {
        if (err) {
            log('Error checking club_events schema:', 'error', null, err, 'error');
            return;
        }

        const columnNames = existingColumns ? existingColumns.map(col => col.name) : [];

        columns.forEach(col => {
            if (!columnNames.includes(col.name)) {
                db.run(`ALTER TABLE club_events ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.defaultValue}`, (err) => {
                    if (err && !err.message.includes('duplicate')) {
                        log(`Error adding ${col.name} column:`, 'error', null, err, 'error');
                    } else {
                        log(`✅ Added ${col.name} column to club_events`, 'init', null, null, 'success');
                    }
                });
            }
        });
    });
}

/**
 * Migrate club_events table to add payment details columns
 */
function migrateClubEventsPaymentColumns() {
    const columns = [
        { name: "bank_details", type: "TEXT", defaultValue: "NULL" },
        { name: "payment_qr_url", type: "TEXT", defaultValue: "NULL" },
        { name: "khalti_number", type: "TEXT", defaultValue: "NULL" },
        { name: "esewa_number", type: "TEXT", defaultValue: "NULL" },
        { name: "payment_instructions", type: "TEXT", defaultValue: "NULL" }
    ];

    db.all("PRAGMA table_info(club_events)", (err, existingColumns) => {
        if (err) {
            log('Error checking club_events schema:', 'error', null, err, 'error');
            return;
        }

        const columnNames = existingColumns ? existingColumns.map(col => col.name) : [];

        columns.forEach(col => {
            if (!columnNames.includes(col.name)) {
                db.run(`ALTER TABLE club_events ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.defaultValue}`, (err) => {
                    if (err && !err.message.includes('duplicate')) {
                        log(`Error adding ${col.name} column:`, 'error', null, err, 'error');
                    } else {
                        log(`✅ Added ${col.name} column to club_events`, 'init', null, null, 'success');
                    }
                });
            }
        });
    });
}

function createClubAnnouncementsTable() {
    db.run(`CREATE TABLE IF NOT EXISTS club_announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        club_id INTEGER NOT NULL,
        guild_id TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        announcement_type TEXT DEFAULT 'general',
        mention_everyone BOOLEAN DEFAULT 0,
        target_roles TEXT,
        image_url TEXT,
        attachments TEXT,
        message_id TEXT,
        channel_id TEXT,
        posted_by TEXT NOT NULL,
        posted_at INTEGER DEFAULT (strftime('%s', 'now')),
        edited_at INTEGER,
        deleted_at INTEGER,
        deleted_by TEXT,
        reactions_count INTEGER DEFAULT 0,
        FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE,
        CHECK(announcement_type IN ('general', 'urgent', 'achievement', 'update'))
    )`, (err) => {
        if (err) log('Error creating club_announcements:', 'error', null, err, 'error');
        else log('✓ club_announcements', 'init');
    });

    migrateTable('club_announcements', [
        { name: "guild_id", type: "TEXT", defaultValue: "NULL" },
        { name: "announcement_type", type: "TEXT", defaultValue: "'general'" },
        { name: "mention_everyone", type: "BOOLEAN", defaultValue: 0 },
        { name: "target_roles", type: "TEXT", defaultValue: "NULL" },
        { name: "image_url", type: "TEXT", defaultValue: "NULL" },
        { name: "attachments", type: "TEXT", defaultValue: "NULL" },
        { name: "message_id", type: "TEXT", defaultValue: "NULL" },
        { name: "channel_id", type: "TEXT", defaultValue: "NULL" },
        { name: "webhook_url", type: "TEXT", defaultValue: "NULL" },
        { name: "edited_at", type: "INTEGER", defaultValue: "NULL" },
        { name: "deleted_at", type: "INTEGER", defaultValue: "NULL" },
        { name: "deleted_by", type: "TEXT", defaultValue: "NULL" },
        { name: "reactions_count", type: "INTEGER", defaultValue: 0 }
    ]);
}

function createClubAuditLogTable() {
    db.run(`CREATE TABLE IF NOT EXISTS club_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        club_id INTEGER,
        action_type TEXT NOT NULL,
        performed_by TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        details TEXT,
        changes TEXT,
        ip_address TEXT,
        user_agent TEXT,
        timestamp INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE SET NULL
    )`, (err) => {
        if (err) log('Error creating club_audit_log:', 'error', null, err, 'error');
        else log('✓ club_audit_log', 'init');
    });

    migrateTable('club_audit_log', [
        { name: "club_id", type: "INTEGER", defaultValue: "NULL" },
        { name: "target_type", type: "TEXT", defaultValue: "NULL" },
        { name: "changes", type: "TEXT", defaultValue: "NULL" },
        { name: "ip_address", type: "TEXT", defaultValue: "NULL" },
        { name: "user_agent", type: "TEXT", defaultValue: "NULL" }
    ]);
}

function createClubResourcesTable() {
    db.run(`CREATE TABLE IF NOT EXISTS club_resources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        club_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        resource_type TEXT NOT NULL,
        resource_url TEXT NOT NULL,
        category TEXT DEFAULT 'general',
        tags TEXT,
        visibility TEXT DEFAULT 'members',
        uploaded_by TEXT NOT NULL,
        uploaded_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        download_count INTEGER DEFAULT 0,
        view_count INTEGER DEFAULT 0,
        FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE,
        CHECK(resource_type IN ('document', 'link', 'video', 'image', 'file')),
        CHECK(visibility IN ('members', 'moderators', 'public'))
    )`, (err) => {
        if (err) log('Error creating club_resources:', 'error', null, err, 'error');
        else log('✓ club_resources', 'init');
    });
}

function createClubSettingsTable() {
    db.run(`CREATE TABLE IF NOT EXISTS club_settings (
        club_id INTEGER PRIMARY KEY,
        notify_new_members BOOLEAN DEFAULT 1,
        notify_new_events BOOLEAN DEFAULT 1,
        notify_announcements BOOLEAN DEFAULT 1,
        auto_approve_joins BOOLEAN DEFAULT 0,
        member_cooldown_days INTEGER DEFAULT 0,
        require_event_approval BOOLEAN DEFAULT 1,
        default_event_visibility TEXT DEFAULT 'club',
        enable_resources BOOLEAN DEFAULT 1,
        enable_team_events BOOLEAN DEFAULT 1,
        enable_attendance BOOLEAN DEFAULT 1,
        enable_contribution_points BOOLEAN DEFAULT 1,
        custom_join_questions TEXT,
        welcome_message TEXT,
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE,
        CHECK(default_event_visibility IN ('club', 'guild', 'public'))
    )`, (err) => {
        if (err) log('Error creating club_settings:', 'error', null, err, 'error');
        else log('✓ club_settings', 'init');
    });
}

// ==================== INDEXES, TRIGGERS, VIEWS ====================

function createClubIndexes() {
    const indexes = [
        'CREATE INDEX IF NOT EXISTS idx_clubs_guild_status ON clubs(guild_id, status)',
        'CREATE INDEX IF NOT EXISTS idx_clubs_slug ON clubs(guild_id, slug)',
        'CREATE INDEX IF NOT EXISTS idx_clubs_president ON clubs(president_user_id)',
        'CREATE INDEX IF NOT EXISTS idx_clubs_role ON clubs(role_id)',
        'CREATE INDEX IF NOT EXISTS idx_clubs_moderator_role ON clubs(moderator_role_id)',
        'CREATE INDEX IF NOT EXISTS idx_club_members_club_status ON club_members(club_id, status)',
        'CREATE INDEX IF NOT EXISTS idx_club_members_user ON club_members(user_id, guild_id)',
        'CREATE INDEX IF NOT EXISTS idx_club_members_role ON club_members(club_id, role)',
        'CREATE INDEX IF NOT EXISTS idx_club_join_requests_status ON club_join_requests(club_id, status)',
        'CREATE INDEX IF NOT EXISTS idx_club_join_requests_user ON club_join_requests(user_id, status)',
        'CREATE INDEX IF NOT EXISTS idx_club_events_club_status ON club_events(club_id, status)',
        'CREATE INDEX IF NOT EXISTS idx_club_events_date ON club_events(event_date, status)',
        'CREATE INDEX IF NOT EXISTS idx_club_events_guild ON club_events(guild_id, status)',
        'CREATE INDEX IF NOT EXISTS idx_event_participants_event ON event_participants(event_id)',
        'CREATE INDEX IF NOT EXISTS idx_event_participants_user ON event_participants(user_id)',
        'CREATE INDEX IF NOT EXISTS idx_event_participants_team ON event_participants(team_id)',
        'CREATE INDEX IF NOT EXISTS idx_club_announcements_club ON club_announcements(club_id, posted_at)',
        'CREATE INDEX IF NOT EXISTS idx_club_audit_log_guild ON club_audit_log(guild_id, timestamp)',
        'CREATE INDEX IF NOT EXISTS idx_club_audit_log_club ON club_audit_log(club_id, timestamp)',
        'CREATE INDEX IF NOT EXISTS idx_club_audit_log_action ON club_audit_log(action_type, timestamp)',
        'CREATE INDEX IF NOT EXISTS idx_club_resources_club ON club_resources(club_id, visibility)'
    ];

    indexes.forEach(sql => db.run(sql, (err) => {
        if (err && !err.message.includes('already exists')) {
            log('Index error:', 'error', null, err, 'error');
        }
    }));

    log('✓ Club indexes created', 'init');
}

function createClubTriggers() {
    const triggers = [
        {
            name: 'clubs_update_timestamp',
            sql: `CREATE TRIGGER IF NOT EXISTS clubs_update_timestamp 
                  AFTER UPDATE ON clubs FOR EACH ROW
                  BEGIN UPDATE clubs SET updated_at = strftime('%s', 'now') WHERE id = NEW.id; END`
        },
        {
            name: 'club_members_update_timestamp',
            sql: `CREATE TRIGGER IF NOT EXISTS club_members_update_timestamp 
                  AFTER UPDATE ON club_members FOR EACH ROW
                  BEGIN UPDATE club_members SET updated_at = strftime('%s', 'now') WHERE id = NEW.id; END`
        },
        {
            name: 'event_participants_update_timestamp',
            sql: `CREATE TRIGGER IF NOT EXISTS event_participants_update_timestamp 
                  AFTER UPDATE ON event_participants FOR EACH ROW
                  BEGIN UPDATE event_participants SET updated_at = strftime('%s', 'now') WHERE id = NEW.id; END`
        }
    ];

    triggers.forEach(trigger => {
        db.run(trigger.sql, (err) => {
            if (err) log(`Trigger ${trigger.name} error:`, 'error', null, err, 'error');
        });
    });

    log('✓ Club triggers created', 'init');
}

function createClubViews() {
    db.run(`CREATE VIEW IF NOT EXISTS view_clubs_summary AS
        SELECT 
            c.id, c.guild_id, c.name, c.slug, c.description, c.logo_url,
            c.president_user_id, c.category, c.status, c.role_id, c.moderator_role_id,
            COUNT(DISTINCT CASE WHEN cm.status = 'active' THEN cm.user_id END) as member_count,
            COUNT(DISTINCT CASE WHEN cm.role = 'moderator' AND cm.status = 'active' THEN cm.user_id END) as moderator_count,
            c.created_at, c.updated_at
        FROM clubs c
        LEFT JOIN club_members cm ON c.id = cm.club_id
        GROUP BY c.id
    `, (err) => {
        if (err) log('View clubs_summary error:', 'error', null, err, 'error');
    });

    db.run(`CREATE VIEW IF NOT EXISTS view_upcoming_events AS
        SELECT 
            e.*, c.name as club_name, c.slug as club_slug,
            COUNT(DISTINCT ep.user_id) as participant_count
        FROM club_events e
        JOIN clubs c ON e.club_id = c.id
        LEFT JOIN event_participants ep ON e.id = ep.event_id AND ep.rsvp_status = 'going'
        WHERE e.status IN ('approved', 'scheduled')
          AND e.event_date >= date('now')
        GROUP BY e.id
        ORDER BY e.event_date ASC, e.start_time ASC
    `, (err) => {
        if (err) log('View upcoming_events error:', 'error', null, err, 'error');
    });

    log('✓ Club views created', 'init');
}

// ==================== UTILITY FUNCTIONS ====================

/**
 * Generic migration helper
 */
function migrateTable(tableName, columns) {
    db.all(`PRAGMA table_info(${tableName})`, (err, existingColumns) => {
        if (err) return;
        const existing = existingColumns.map(col => col.name);

        columns.forEach(col => {
            if (!existing.includes(col.name)) {
                db.run(`ALTER TABLE ${tableName} ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.defaultValue}`, (err) => {
                    if (err && !err.message.includes('duplicate')) {
                        log(`Migration ${tableName}.${col.name} failed:`, 'error', null, err, 'error');
                    }
                });
            }
        });
    });
}

/**
 * Generate URL-friendly slug from club name
 */
function generateSlug(name) {
    return name
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .substring(0, 50);
}

/**
 * Get club by name or slug
 */
async function getClubByIdentifier(guildId, identifier) {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT * FROM clubs WHERE guild_id = ? AND (LOWER(name) = LOWER(?) OR slug = ?) AND status = 'active'`,
            [guildId, identifier, identifier.toLowerCase()],
            (err, row) => {
                if (err) reject(err);
                else resolve(row);
            }
        );
    });
}

/**
 * Check if user is club president
 */
async function isClubPresident(clubId, userId) {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT id FROM clubs WHERE id = ? AND president_user_id = ?`,
            [clubId, userId],
            (err, row) => {
                if (err) reject(err);
                else resolve(!!row);
            }
        );
    });
}

/**
 * Check if user is club moderator
 */
async function isClubModerator(clubId, userId) {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT id FROM club_members WHERE club_id = ? AND user_id = ? AND role IN ('moderator', 'president') AND status = 'active'`,
            [clubId, userId],
            (err, row) => {
                if (err) reject(err);
                else resolve(!!row);
            }
        );
    });
}

/**
 * Check if user has club permission
 */
async function hasClubPermission(clubId, userId, permission = 'moderate') {
    if (permission === 'president') {
        return await isClubPresident(clubId, userId);
    }
    if (permission === 'moderate') {
        return await isClubModerator(clubId, userId);
    }
    return false;
}

export {
    initializeDatabase,
    db,
    getClubByIdentifier,
    isClubPresident,
    isClubModerator,
    hasClubPermission,
    generateSlug
};