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
 * Initializes the SQLite database with enhanced club management
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
                // ========== EXISTING TABLES (unchanged) ==========
                
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
                    if (err) log('Error creating guild_configs table:', 'error', null, err, 'error');
                    else log('Guild configs table checked/created.', 'init');
                });

                // Migration for guild_configs
                db.all("PRAGMA table_info(guild_configs)", (err, columns) => {
                    if (err) {
                        log("Error checking guild_configs schema:", 'error', null, err, 'error');
                        return;
                    }
                    const columnNames = Array.isArray(columns) ? columns.map(col => col.name) : [];
                    const configColumnsToAdd = [
                        { name: "farewell_channel_id", type: "TEXT", defaultValue: "NULL" },
                        { name: "rep_deduction_per_warn", type: "INTEGER", defaultValue: 10 },
                        { name: "rep_lockout_duration_ms", type: "INTEGER", defaultValue: 86400000 },
                        { name: "rep_to_clear_warn", type: "INTEGER", defaultValue: 20 }
                    ];

                    configColumnsToAdd.forEach(col => {
                        if (!columnNames.includes(col.name)) {
                            db.run(`ALTER TABLE guild_configs ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.defaultValue}`, (alterErr) => {
                                if (alterErr) log(`Error adding ${col.name} to guild_configs:`, 'error', null, alterErr, 'error');
                                else log(`Added ${col.name} column to guild_configs.`, 'init');
                            });
                        }
                    });
                });

                db.run(`CREATE TABLE IF NOT EXISTS reaction_roles (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    guild_id TEXT NOT NULL,
                    message_id TEXT NOT NULL,
                    emoji TEXT NOT NULL,
                    role_id TEXT NOT NULL,
                    UNIQUE(message_id, emoji, guild_id) ON CONFLICT REPLACE
                )`, (err) => {
                    if (err) log('Error creating reaction_roles table:', 'error', null, err, 'error');
                    else log('Reaction roles table checked/created.', 'init');
                });

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
                    if (err) log('Error creating suggestions table:', 'error', null, err, 'error');
                    else log('Suggestions table checked/created.', 'init');
                });

                db.run(`CREATE TABLE IF NOT EXISTS user_stats (
                    user_id TEXT NOT NULL,
                    guild_id TEXT NOT NULL,
                    messages_sent INTEGER DEFAULT 0,
                    voice_time_minutes REAL DEFAULT 0.0,
                    last_message_at INTEGER,
                    reputation_lockout_until INTEGER DEFAULT 0,
                    PRIMARY KEY (user_id, guild_id)
                )`, (err) => {
                    if (err) log('Error creating user_stats table:', 'error', null, err, 'error');
                    else log('User stats table checked/created.', 'init');
                });

                db.all("PRAGMA table_info(user_stats)", (err, columns) => {
                    if (err) {
                        log("Error checking user_stats schema:", 'error', null, err, 'error');
                        return;
                    }
                    const columnNames = Array.isArray(columns) ? columns.map(col => col.name) : [];
                    if (!columnNames.includes("reputation_lockout_until")) {
                        db.run("ALTER TABLE user_stats ADD COLUMN reputation_lockout_until INTEGER DEFAULT 0", (alterErr) => {
                            if (alterErr) log("Error adding reputation_lockout_until to user_stats:", 'error', null, alterErr, 'error');
                            else log("Added reputation_lockout_until column to user_stats.", 'init');
                        });
                    }
                });

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
                    if (err) log('Error creating birthdays table:', 'error', null, err, 'error');
                    else log('Birthdays table checked/created.', 'init');
                });

                db.run(`CREATE TABLE IF NOT EXISTS warnings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    userId TEXT NOT NULL,
                    guildId TEXT NOT NULL,
                    moderatorId TEXT NOT NULL,
                    reason TEXT,
                    timestamp INTEGER
                )`, (err) => {
                    if (err) log('Error creating warnings table:', 'error', null, err, 'error');
                    else log('Warnings table checked/created.', 'init');
                });

                db.run(`CREATE TABLE IF NOT EXISTS verified_users (
                    user_id TEXT NOT NULL PRIMARY KEY,
                    guild_id TEXT NOT NULL,
                    real_name TEXT NOT NULL,
                    discord_username TEXT NOT NULL,
                    email TEXT NOT NULL UNIQUE,
                    verified_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, (err) => {
                    if (err) log('Error creating verified_users table:', 'error', null, err, 'error');
                    else log('Verified users table checked/created.', 'init');
                });

                db.run(`CREATE TABLE IF NOT EXISTS active_voice_sessions (
                    user_id TEXT NOT NULL,
                    guild_id TEXT NOT NULL,
                    channel_id TEXT NOT NULL,
                    join_time INTEGER NOT NULL,
                    PRIMARY KEY (user_id, guild_id)
                )`, (err) => {
                    if (err) log('Error creating active_voice_sessions table:', 'error', null, err, 'error');
                    else log('Active voice sessions table checked/created.', 'init');
                });

                db.run(`CREATE TABLE IF NOT EXISTS notices (
                    title TEXT NOT NULL,
                    link TEXT NOT NULL,
                    date TEXT NOT NULL,
                    announced_at INTEGER NOT NULL,
                    PRIMARY KEY (link)
                )`, (err) => {
                    if (err) log('Error creating notices table:', 'error', null, err, 'error');
                    else log('Notices table checked/created.', 'init');
                });

                db.run(`CREATE TABLE IF NOT EXISTS anti_spam_configs (
                    guild_id TEXT PRIMARY KEY,
                    message_limit INTEGER DEFAULT 5,
                    time_window_seconds INTEGER DEFAULT 5,
                    mute_duration_seconds INTEGER DEFAULT 300,
                    kick_threshold INTEGER DEFAULT 3,
                    ban_threshold INTEGER DEFAULT 5,
                    UNIQUE(guild_id) ON CONFLICT REPLACE
                )`, (err) => {
                    if (err) log('Error creating anti_spam_configs table:', 'error', null, err, 'error');
                    else log('Anti-spam configs table checked/created.', 'init');
                });

                db.all("PRAGMA table_info(anti_spam_configs)", (err, columns) => {
                    if (err) {
                        log("Error checking anti_spam_configs schema:", 'error', null, err, 'error');
                        return;
                    }
                    const existingColumns = Array.isArray(columns) ? columns.map(col => col.name) : [];
                    const columnsToAdd = [
                        { name: "message_limit", type: "INTEGER", defaultValue: 5 },
                        { name: "time_window_seconds", type: "INTEGER", defaultValue: 5 },
                        { name: "mute_duration_seconds", type: "INTEGER", defaultValue: 300 },
                        { name: "kick_threshold", type: "INTEGER", defaultValue: 3 },
                        { name: "ban_threshold", type: "INTEGER", defaultValue: 5 }
                    ];

                    columnsToAdd.forEach(col => {
                        if (!existingColumns.includes(col.name)) {
                            db.run(`ALTER TABLE anti_spam_configs ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.defaultValue}`, (alterErr) => {
                                if (alterErr) log(`Error adding ${col.name} to anti_spam_configs:`, 'error', null, alterErr, 'error');
                                else log(`Added ${col.name} column to anti_spam_configs.`, 'init');
                            });
                        }
                    });
                });

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
                    if (err) log('Error creating faqs table:', 'error', null, err, 'error');
                    else log('Faqs table checked/created.', 'init');
                });

                db.all("PRAGMA table_info(faqs)", (err, columns) => {
                    if (err) {
                        log("Error checking faqs schema:", 'error', null, err, 'error');
                        return;
                    }
                    const columnNames = Array.isArray(columns) ? columns.map(col => col.name) : [];
                    if (!columnNames.includes("keywords")) {
                        db.run("ALTER TABLE faqs ADD COLUMN keywords TEXT", (alterErr) => {
                            if (alterErr) log("Error adding keywords column to faqs:", 'error', null, alterErr, 'error');
                            else log("Added keywords column to faqs.", 'init');
                        });
                    }
                    if (!columnNames.includes("created_by")) {
                        db.run("ALTER TABLE faqs ADD COLUMN created_by TEXT", (alterErr) => {
                            if (alterErr) log("Error adding created_by column to faqs:", 'error', null, alterErr, 'error');
                            else log("Added created_by column to faqs.", 'init');
                        });
                    }
                });

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
                    if (err) log('Error creating admin_tasks table:', 'error', null, err, 'error');
                    else log('Admin tasks table checked/created.', 'init');
                });

                db.all("PRAGMA table_info(admin_tasks)", (err, columns) => {
                    if (err) {
                        log("Error checking admin_tasks schema:", 'error', null, err, 'error');
                        return;
                    }
                    const columnNames = Array.isArray(columns) ? columns.map(col => col.name) : [];

                    if (!columnNames.includes("creatorId")) {
                        db.run("ALTER TABLE admin_tasks ADD COLUMN creatorId TEXT", (alterErr) => {
                            if (alterErr) log("Error adding creatorId column to admin_tasks:", 'error', null, alterErr, 'error');
                            else log("Added creatorId column to admin_tasks.", 'init');
                        });
                    }

                    if (!columnNames.includes("taskDescription")) {
                        db.run("ALTER TABLE admin_tasks ADD COLUMN taskDescription TEXT", (alterErr) => {
                            if (alterErr) log("Error adding taskDescription column to admin_tasks:", 'error', null, alterErr, 'error');
                            else log("Added taskDescription column to admin_tasks.", 'init');
                        });
                    }

                    if (!columnNames.includes("createdAt")) {
                        db.run("ALTER TABLE admin_tasks ADD COLUMN createdAt INTEGER", (alterErr) => {
                            if (alterErr) log("Error adding createdAt column to admin_tasks:", 'error', null, alterErr, 'error');
                            else log("Added createdAt column to admin_tasks.", 'init');
                        });
                    }
                });

                db.run(`CREATE TABLE IF NOT EXISTS rss_feeds (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    guild_id TEXT NOT NULL,
                    channel_id TEXT NOT NULL,
                    url TEXT NOT NULL,
                    last_guid TEXT,
                    title TEXT,
                    UNIQUE(guild_id, channel_id, url)
                )`, (err) => {
                    if (err) log('Error creating rss_feeds table:', 'error', null, err, 'error');
                    else log('Rss_feeds table checked/created.', 'init');
                });

                db.all("PRAGMA table_info(rss_feeds)", (err, columns) => {
                    if (err) {
                        log("Error checking rss_feeds schema:", 'error', null, err, 'error');
                        return;
                    }
                    const columnNames = Array.isArray(columns) ? columns.map(col => col.name) : [];
                    if (!columnNames.includes("title")) {
                        db.run("ALTER TABLE rss_feeds ADD COLUMN title TEXT", (alterErr) => {
                            if (alterErr) log("Error adding title column to rss_feeds:", 'error', null, alterErr, 'error');
                            else log("Added title column to rss_feeds.", 'init');
                        });
                    }
                });

                db.run(`CREATE TABLE IF NOT EXISTS moderation_actions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    action_type TEXT NOT NULL,
                    moderator_id TEXT NOT NULL,
                    target_user_id TEXT NOT NULL,
                    guild_id TEXT NOT NULL,
                    timestamp INTEGER NOT NULL,
                    reason TEXT
                )`, (err) => {
                    if (err) log('Error creating moderation_actions table:', 'error', null, err, 'error');
                    else log('Moderation actions table checked/created.', 'init');
                });

                db.run(`CREATE TABLE IF NOT EXISTS reputation (
                    user_id TEXT NOT NULL,
                    guild_id TEXT NOT NULL,
                    reputation_points INTEGER DEFAULT 0,
                    PRIMARY KEY (user_id, guild_id)
                )`, (err) => {
                    if (err) log('Error creating reputation table:', 'error', null, err, 'error');
                    else log('Reputation table checked/created.', 'init');
                });

                db.run(`CREATE TABLE IF NOT EXISTS mod_cooldowns (
                    command_name TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    last_used_at INTEGER NOT NULL,
                    PRIMARY KEY (command_name, user_id)
                )`, (err) => {
                    if (err) log('Error creating mod_cooldowns table:', 'error', null, err, 'error');
                    else log('Mod cooldowns table checked/created.', 'init');
                });

                // ========== ENHANCED CLUB MANAGEMENT SYSTEM ==========

                /**
                 * 1. CLUBS TABLE (Enhanced with slug for better UX)
                 */
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
                    if (err) log('Error creating clubs table:', 'error', null, err, 'error');
                    else log('Clubs table checked/created.', 'init');
                });

                // Migrations for clubs table
                db.all("PRAGMA table_info(clubs)", (err, columns) => {
                    if (err) {
                        log("Error checking clubs schema:", 'error', null, err, 'error');
                        return;
                    }
                    const columnNames = Array.isArray(columns) ? columns.map(col => col.name) : [];
                    const clubColumnsToAdd = [
                        { name: "slug", type: "TEXT", defaultValue: "NULL" },
                        { name: "moderator_role_id", type: "TEXT", defaultValue: "NULL" },
                        { name: "category_id", type: "TEXT", defaultValue: "NULL" },
                        { name: "contact_email", type: "TEXT", defaultValue: "NULL" },
                        { name: "contact_phone", type: "TEXT", defaultValue: "NULL" },
                        { name: "website_url", type: "TEXT", defaultValue: "NULL" },
                        { name: "social_media", type: "TEXT", defaultValue: "NULL" },
                        { name: "require_approval", type: "BOOLEAN", defaultValue: 1 },
                        { name: "is_public", type: "BOOLEAN", defaultValue: 1 },
                        { name: "approved_at", type: "INTEGER", defaultValue: "NULL" },
                        { name: "approved_by", type: "TEXT", defaultValue: "NULL" }
                    ];

                    clubColumnsToAdd.forEach(col => {
                        if (!columnNames.includes(col.name)) {
                            db.run(`ALTER TABLE clubs ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.defaultValue}`, (alterErr) => {
                                if (alterErr) log(`Error adding ${col.name} to clubs:`, 'error', null, alterErr, 'error');
                                else log(`Added ${col.name} column to clubs.`, 'init');
                            });
                        }
                    });
                    
                    // Generate slugs for existing clubs without slugs
                    if (columnNames.includes("slug")) {
                        db.all(`SELECT id, name FROM clubs WHERE slug IS NULL`, [], (err, rows) => {
                            if (err) {
                                log("Error fetching clubs without slugs:", 'error', null, err, 'error');
                                return;
                            }
                            if (rows && rows.length > 0) {
                                rows.forEach(club => {
                                    const slug = generateSlug(club.name);
                                    db.run(`UPDATE clubs SET slug = ? WHERE id = ?`, [slug, club.id], (updateErr) => {
                                        if (updateErr) {
                                            log(`Error updating slug for club ${club.id}:`, 'error', null, updateErr, 'error');
                                        } else {
                                            log(`Generated slug "${slug}" for club ${club.id}`, 'init');
                                        }
                                    });
                                });
                            }
                        });
                    }
                });

                /**
                 * 2. CLUB_MEMBERS TABLE (Enhanced with role field)
                 */
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
                    if (err) log('Error creating club_members table:', 'error', null, err, 'error');
                    else log('Club members table checked/created.', 'init');
                });

                // Migrations for club_members
                db.all("PRAGMA table_info(club_members)", (err, columns) => {
                    if (err) {
                        log("Error checking club_members schema:", 'error', null, err, 'error');
                        return;
                    }
                    const columnNames = Array.isArray(columns) ? columns.map(col => col.name) : [];
                    const memberColumnsToAdd = [
                        { name: "last_active_at", type: "INTEGER", defaultValue: "NULL" },
                        { name: "removed_at", type: "INTEGER", defaultValue: "NULL" },
                        { name: "removed_by", type: "TEXT", defaultValue: "NULL" },
                        { name: "removal_reason", type: "TEXT", defaultValue: "NULL" }
                    ];

                    memberColumnsToAdd.forEach(col => {
                        if (!columnNames.includes(col.name)) {
                            db.run(`ALTER TABLE club_members ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.defaultValue}`, (alterErr) => {
                                if (alterErr) log(`Error adding ${col.name} to club_members:`, 'error', null, alterErr, 'error');
                                else log(`Added ${col.name} column to club_members.`, 'init');
                            });
                        }
                    });
                });

                /**
                 * 3. CLUB_JOIN_REQUESTS TABLE (Enhanced)
                 */
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
                    if (err) log('Error creating club_join_requests table:', 'error', null, err, 'error');
                    else log('Club join requests table checked/created.', 'init');
                });

                // Migrations for club_join_requests
                db.all("PRAGMA table_info(club_join_requests)", (err, columns) => {
                    if (err) {
                        log("Error checking club_join_requests schema:", 'error', null, err, 'error');
                        return;
                    }
                    const columnNames = Array.isArray(columns) ? columns.map(col => col.name) : [];
                    const requestColumnsToAdd = [
                        { name: "email", type: "TEXT", defaultValue: "NULL" },
                        { name: "experience", type: "TEXT", defaultValue: "NULL" },
                        { name: "expectations", type: "TEXT", defaultValue: "NULL" },
                        { name: "rejection_reason", type: "TEXT", defaultValue: "NULL" },
                        { name: "updated_at", type: "INTEGER", defaultValue: "(strftime('%s', 'now'))" }
                    ];

                    requestColumnsToAdd.forEach(col => {
                        if (!columnNames.includes(col.name)) {
                            db.run(`ALTER TABLE club_join_requests ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.defaultValue}`, (alterErr) => {
                                if (alterErr) log(`Error adding ${col.name} to club_join_requests:`, 'error', null, alterErr, 'error');
                                else log(`Added ${col.name} column to club_join_requests.`, 'init');
                            });
                        }
                    });
                });

                /**
                 * 4. CLUB_EVENTS TABLE (Enhanced)
                 */
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
                    if (err) log('Error creating club_events table:', 'error', null, err, 'error');
                    else log('Club events table checked/created.', 'init');
                });

                // Migrations for club_events
                db.all("PRAGMA table_info(club_events)", (err, columns) => {
                    if (err) {
                        log("Error checking club_events schema:", 'error', null, err, 'error');
                        return;
                    }
                    const columnNames = Array.isArray(columns) ? columns.map(col => col.name) : [];
                    const eventColumnsToAdd = [
                        { name: "timezone", type: "TEXT", defaultValue: "'UTC'" },
                        { name: "location_type", type: "TEXT", defaultValue: "'physical'" },
                        { name: "meeting_link", type: "TEXT", defaultValue: "NULL" },
                        { name: "registration_required", type: "BOOLEAN", defaultValue: 0 },
                        { name: "registration_deadline", type: "TEXT", defaultValue: "NULL" },
                        { name: "min_participants", type: "INTEGER", defaultValue: "NULL" },
                        { name: "registration_fee", type: "NUMERIC", defaultValue: 0 },
                        { name: "external_form_url", type: "TEXT", defaultValue: "NULL" },
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

                    eventColumnsToAdd.forEach(col => {
                        if (!columnNames.includes(col.name)) {
                            db.run(`ALTER TABLE club_events ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.defaultValue}`, (alterErr) => {
                                if (alterErr) log(`Error adding ${col.name} to club_events:`, 'error', null, alterErr, 'error');
                                else log(`Added ${col.name} column to club_events.`, 'init');
                            });
                        }
                    });
                });

                /**
                 * 5. EVENT_PARTICIPANTS TABLE (Combined RSVPs + registrations)
                 */
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
                    if (err) log('Error creating event_participants table:', 'error', null, err, 'error');
                    else log('Event participants table checked/created.', 'init');
                });

                // Migrations for event_participants
                db.all("PRAGMA table_info(event_participants)", (err, columns) => {
                    if (err) {
                        log("Error checking event_participants schema:", 'error', null, err, 'error');
                        return;
                    }
                    const columnNames = Array.isArray(columns) ? columns.map(col => col.name) : [];
                    const participantColumnsToAdd = [
                        { name: "team_id", type: "TEXT", defaultValue: "NULL" },
                        { name: "registration_date", type: "INTEGER", defaultValue: "(strftime('%s', 'now'))" },
                        { name: "rsvp_status", type: "TEXT", defaultValue: "'going'" },
                        { name: "checked_in", type: "BOOLEAN", defaultValue: 0 },
                        { name: "checked_in_at", type: "INTEGER", defaultValue: "NULL" },
                        { name: "attendance_confirmed", type: "BOOLEAN", defaultValue: 0 },
                        { name: "rating", type: "INTEGER", defaultValue: "NULL" },
                        { name: "feedback", type: "TEXT", defaultValue: "NULL" },
                        { name: "updated_at", type: "INTEGER", defaultValue: "(strftime('%s', 'now'))" }
                    ];

                    participantColumnsToAdd.forEach(col => {
                        if (!columnNames.includes(col.name)) {
                            db.run(`ALTER TABLE event_participants ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.defaultValue}`, (alterErr) => {
                                if (alterErr) log(`Error adding ${col.name} to event_participants:`, 'error', null, alterErr, 'error');
                                else log(`Added ${col.name} column to event_participants.`, 'init');
                            });
                        }
                    });
                });

                /**
                 * 6. CLUB_ANNOUNCEMENTS TABLE (Enhanced)
                 */
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
                    if (err) log('Error creating club_announcements table:', 'error', null, err, 'error');
                    else log('Club announcements table checked/created.', 'init');
                });

                // Migrations for club_announcements
                db.all("PRAGMA table_info(club_announcements)", (err, columns) => {
                    if (err) {
                        log("Error checking club_announcements schema:", 'error', null, err, 'error');
                        return;
                    }
                    const columnNames = Array.isArray(columns) ? columns.map(col => col.name) : [];
                    const announcementColumnsToAdd = [
                        { name: "guild_id", type: "TEXT", defaultValue: "NULL" },
                        { name: "announcement_type", type: "TEXT", defaultValue: "'general'" },
                        { name: "mention_everyone", type: "BOOLEAN", defaultValue: 0 },
                        { name: "target_roles", type: "TEXT", defaultValue: "NULL" },
                        { name: "image_url", type: "TEXT", defaultValue: "NULL" },
                        { name: "attachments", type: "TEXT", defaultValue: "NULL" },
                        { name: "message_id", type: "TEXT", defaultValue: "NULL" },
                        { name: "channel_id", type: "TEXT", defaultValue: "NULL" },
                        { name: "edited_at", type: "INTEGER", defaultValue: "NULL" },
                        { name: "deleted_at", type: "INTEGER", defaultValue: "NULL" },
                        { name: "deleted_by", type: "TEXT", defaultValue: "NULL" },
                        { name: "reactions_count", type: "INTEGER", defaultValue: 0 }
                    ];

                    announcementColumnsToAdd.forEach(col => {
                        if (!columnNames.includes(col.name)) {
                            db.run(`ALTER TABLE club_announcements ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.defaultValue}`, (alterErr) => {
                                if (alterErr) log(`Error adding ${col.name} to club_announcements:`, 'error', null, alterErr, 'error');
                                else log(`Added ${col.name} column to club_announcements.`, 'init');
                            });
                        }
                    });
                });

                /**
                 * 7. CLUB_AUDIT_LOG TABLE (Enhanced)
                 */
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
                    if (err) log('Error creating club_audit_log table:', 'error', null, err, 'error');
                    else log('Club audit log table checked/created.', 'init');
                });

                // Migrations for club_audit_log
                db.all("PRAGMA table_info(club_audit_log)", (err, columns) => {
                    if (err) {
                        log("Error checking club_audit_log schema:", 'error', null, err, 'error');
                        return;
                    }
                    const columnNames = Array.isArray(columns) ? columns.map(col => col.name) : [];
                    const auditColumnsToAdd = [
                        { name: "club_id", type: "INTEGER", defaultValue: "NULL" },
                        { name: "target_type", type: "TEXT", defaultValue: "NULL" },
                        { name: "changes", type: "TEXT", defaultValue: "NULL" },
                        { name: "ip_address", type: "TEXT", defaultValue: "NULL" },
                        { name: "user_agent", type: "TEXT", defaultValue: "NULL" }
                    ];

                    auditColumnsToAdd.forEach(col => {
                        if (!columnNames.includes(col.name)) {
                            db.run(`ALTER TABLE club_audit_log ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.defaultValue}`, (alterErr) => {
                                if (alterErr) log(`Error adding ${col.name} to club_audit_log:`, 'error', null, alterErr, 'error');
                                else log(`Added ${col.name} column to club_audit_log.`, 'init');
                            });
                        }
                    });
                });

                /**
                 * 8. CLUB_RESOURCES TABLE
                 */
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
                    if (err) log('Error creating club_resources table:', 'error', null, err, 'error');
                    else log('Club resources table checked/created.', 'init');
                });

                /**
                 * 9. CLUB_SETTINGS TABLE
                 */
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
                    if (err) log('Error creating club_settings table:', 'error', null, err, 'error');
                    else log('Club settings table checked/created.', 'init');
                });

                /**
                 * CREATE INDEXES FOR PERFORMANCE
                 */
                const clubIndexes = [
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

                clubIndexes.forEach(indexQuery => {
                    db.run(indexQuery, (err) => {
                        if (err && !err.message.includes('already exists')) {
                            log('Error creating club index:', 'error', null, err, 'error');
                        }
                    });
                });

                log('Club indexes created.', 'init');

                /**
                 * CREATE TRIGGERS FOR AUTO-UPDATE
                 */
                db.run(`
                    CREATE TRIGGER IF NOT EXISTS clubs_update_timestamp 
                    AFTER UPDATE ON clubs
                    FOR EACH ROW
                    BEGIN
                        UPDATE clubs SET updated_at = strftime('%s', 'now') WHERE id = NEW.id;
                    END
                `, (err) => {
                    if (err) log('Error creating clubs update trigger:', 'error', null, err, 'error');
                    else log('Clubs update trigger created.', 'init');
                });

                db.run(`
                    CREATE TRIGGER IF NOT EXISTS club_members_update_timestamp 
                    AFTER UPDATE ON club_members
                    FOR EACH ROW
                    BEGIN
                        UPDATE club_members SET updated_at = strftime('%s', 'now') WHERE id = NEW.id;
                    END
                `, (err) => {
                    if (err) log('Error creating club_members update trigger:', 'error', null, err, 'error');
                    else log('Club members update trigger created.', 'init');
                });

                db.run(`
                    CREATE TRIGGER IF NOT EXISTS event_participants_update_timestamp 
                    AFTER UPDATE ON event_participants
                    FOR EACH ROW
                    BEGIN
                        UPDATE event_participants SET updated_at = strftime('%s', 'now') WHERE id = NEW.id;
                    END
                `, (err) => {
                    if (err) log('Error creating event_participants update trigger:', 'error', null, err, 'error');
                    else log('Event participants update trigger created.', 'init');
                });

                /**
                 * CREATE VIEWS FOR COMMON QUERIES
                 */
                db.run(`
                    CREATE VIEW IF NOT EXISTS view_clubs_summary AS
                    SELECT 
                        c.id,
                        c.guild_id,
                        c.name,
                        c.slug,
                        c.description,
                        c.logo_url,
                        c.president_user_id,
                        c.category,
                        c.status,
                        c.role_id,
                        c.moderator_role_id,
                        COUNT(DISTINCT CASE WHEN cm.status = 'active' THEN cm.user_id END) as member_count,
                        COUNT(DISTINCT CASE WHEN cm.role = 'moderator' AND cm.status = 'active' THEN cm.user_id END) as moderator_count,
                        c.created_at,
                        c.updated_at
                    FROM clubs c
                    LEFT JOIN club_members cm ON c.id = cm.club_id
                    GROUP BY c.id
                `, (err) => {
                    if (err) log('Error creating clubs summary view:', 'error', null, err, 'error');
                    else log('Clubs summary view created.', 'init');
                });

                db.run(`
                    CREATE VIEW IF NOT EXISTS view_upcoming_events AS
                    SELECT 
                        e.*,
                        c.name as club_name,
                        c.slug as club_slug,
                        COUNT(DISTINCT ep.user_id) as participant_count
                    FROM club_events e
                    JOIN clubs c ON e.club_id = c.id
                    LEFT JOIN event_participants ep ON e.id = ep.event_id AND ep.rsvp_status = 'going'
                    WHERE e.status IN ('approved', 'scheduled')
                      AND e.event_date >= date('now')
                    GROUP BY e.id
                    ORDER BY e.event_date ASC, e.start_time ASC
                `, (err) => {
                    if (err) log('Error creating upcoming events view:', 'error', null, err, 'error');
                    else log('Upcoming events view created.', 'init');
                });

                log('All database tables checked/created and schema updated.', 'init');
                resolve(db);
            });
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
        .replace(/[^\w\s-]/g, '') // Remove special characters
        .replace(/\s+/g, '-')      // Replace spaces with hyphens
        .replace(/-+/g, '-')       // Replace multiple hyphens with single
        .substring(0, 50);         // Limit length
}

/**
 * Helper: Get club by name or slug
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
 * Helper: Check if user is club president
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
 * Helper: Check if user is club moderator
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
 * Helper: Check if user has club permission
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