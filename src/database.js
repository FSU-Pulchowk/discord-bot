import sqlite3 from 'sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Get the current file's path and directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Define the path to the SQLite database file
const dbPath = path.resolve(__dirname, '../bot.db');

let db; // Variable to hold the database connection object

/**
 * Initializes the SQLite database, creating tables and performing necessary migrations if they don't exist.
 * This function ensures the database schema is up-to-date.
 * @returns {Promise<sqlite3.Database>} A promise that resolves with the database object once initialized.
 */
async function initializeDatabase() {
    return new Promise((resolve, reject) => {
        // Connect to the SQLite database. If the file doesn't exist, it will be created.
        db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
            if (err) {
                console.error('Error connecting to database:', err.message);
                return reject(err);
            }
            console.log('Connected to the SQLite database.');

            // Serialize ensures that database operations run in sequence
            db.serialize(() => {
                /**
                 * guild_configs Table: Stores server-specific configurations.
                 * - guild_id: Unique identifier for the Discord server (Primary Key).
                 * - welcome_message_content: The content of the welcome message for new members.
                 * - welcome_channel_id: The channel ID where welcome messages are sent.
                 * - send_welcome_as_dm: Boolean indicating if welcome messages should be sent as DMs.
                 * - farewell_channel_id: The channel ID where farewell messages are sent.
                 * - rep_deduction_per_warn: Number of reputation points deducted when a user receives a warn.
                 * - rep_lockout_duration_ms: Duration in milliseconds for which a user cannot gain reputation after a warn.
                 * - rep_to_clear_warn: Number of reputation points needed to clear one warning.
                 */
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
                )`);

                // Migrations for guild_configs: Add new columns if they don't exist
                db.all("PRAGMA table_info(guild_configs)", (err, columns) => {
                    if (err) {
                        console.error("Error checking guild_configs schema:", err.message);
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
                                if (alterErr) {
                                    console.error(`Error adding ${col.name} to guild_configs:`, alterErr.message);
                                } else {
                                    console.log(`Added ${col.name} column to guild_configs.`);
                                }
                            });
                        }
                    });
                });

                /**
                 * reaction_roles Table: Stores configurations for reaction roles.
                 * - id: Auto-incrementing primary key.
                 * - guild_id: The ID of the guild the reaction role is in.
                 * - message_id: The ID of the message with the reaction roles.
                 * - emoji: The emoji used for the reaction.
                 * - role_id: The ID of the role to be assigned.
                 */
                db.run(`CREATE TABLE IF NOT EXISTS reaction_roles (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    guild_id TEXT NOT NULL,
                    message_id TEXT NOT NULL,
                    emoji TEXT NOT NULL,
                    role_id TEXT NOT NULL,
                    UNIQUE(message_id, emoji, guild_id) ON CONFLICT REPLACE
                )`);

                /**
                 * suggestions Table: Stores user suggestions.
                 * - id: Auto-incrementing primary key.
                 * - guild_id: The ID of the guild the suggestion belongs to.
                 * - user_id: The ID of the user who submitted the suggestion.
                 * - message_id: The ID of the Discord message associated with the suggestion (if any).
                 * - suggestion_text: The content of the suggestion.
                 * - status: Current status of the suggestion (e.g., 'pending', 'approved', 'denied').
                 * - submitted_at: Timestamp when the suggestion was submitted.
                 * - reviewed_by: ID of the moderator who reviewed the suggestion.
                 * - reviewed_at: Timestamp when the suggestion was reviewed.
                 * - reason: Reason for approval/denial.
                 * - upvotes: Number of upvotes.
                 * - downvotes: Number of downvotes.
                 */
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
                )`);

                /**
                 * user_stats Table: Stores various statistics for users.
                 * - user_id: Unique identifier for the user.
                 * - guild_id: Unique identifier for the Discord server.
                 * - messages_sent: Number of messages sent by the user in the guild.
                 * - voice_time_minutes: Total voice chat time in minutes for the user in the guild.
                 * - last_message_at: Timestamp of the user's last message.
                 * - reputation_lockout_until: Timestamp until which the user cannot gain reputation. Used for warning system.
                 * Composite Primary Key: (user_id, guild_id)
                 */
                db.run(`CREATE TABLE IF NOT EXISTS user_stats (
                    user_id TEXT NOT NULL,
                    guild_id TEXT NOT NULL,
                    messages_sent INTEGER DEFAULT 0,
                    voice_time_minutes REAL DEFAULT 0.0,
                    last_message_at INTEGER,
                    reputation_lockout_until INTEGER DEFAULT 0,
                    PRIMARY KEY (user_id, guild_id)
                )`);

                // Migration for user_stats: Add 'reputation_lockout_until' column if it doesn't exist
                db.all("PRAGMA table_info(user_stats)", (err, columns) => {
                    if (err) {
                        console.error("Error checking user_stats schema:", err.message);
                        return;
                    }
                    const columnNames = Array.isArray(columns) ? columns.map(col => col.name) : [];
                    if (!columnNames.includes("reputation_lockout_until")) {
                        db.run("ALTER TABLE user_stats ADD COLUMN reputation_lockout_until INTEGER DEFAULT 0", (alterErr) => {
                            if (alterErr) {
                                console.error("Error adding reputation_lockout_until to user_stats:", alterErr.message);
                            } else {
                                console.log("Added reputation_lockout_until column to user_stats.");
                            }
                        });
                    }
                });

                /**
                 * birthdays Table: Stores user birthdays.
                 * - user_id: Unique identifier for the user.
                 * - guild_id: Unique identifier for the Discord server.
                 * - month: Birth month.
                 * - day: Birth day.
                 * - year: Birth year (optional).
                 * - set_by: ID of the user who set the birthday.
                 * - created_at: Timestamp when the birthday was added.
                 * Composite Primary Key: (user_id, guild_id)
                 */
                db.run(`CREATE TABLE IF NOT EXISTS birthdays (
                    user_id TEXT NOT NULL,
                    guild_id TEXT NOT NULL,
                    month INTEGER NOT NULL,
                    day INTEGER NOT NULL,
                    year INTEGER,
                    set_by TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (user_id, guild_id)
                )`);

                /**
                 * warnings Table: Stores moderation warnings issued to users.
                 * - id: Auto-incrementing primary key.
                 * - userId: The ID of the user who received the warning.
                 * - guildId: The ID of the guild where the warning was issued.
                 * - moderatorId: The ID of the moderator who issued the warning.
                 * - reason: The reason for the warning.
                 * - timestamp: The Unix timestamp when the warning was issued.
                 */
                db.run(`
                    CREATE TABLE IF NOT EXISTS warnings (id INTEGER PRIMARY KEY AUTOINCREMENT,
                    userId TEXT NOT NULL,
                    guildId TEXT NOT NULL,
                    moderatorId TEXT NOT NULL,
                    reason TEXT,
                    timestamp INTEGER
                )`);

                /**
                 * verified_users Table: Stores information about verified users.
                 * - user_id: Unique identifier for the user (Primary Key).
                 * - guild_id: Unique identifier for the Discord server.
                 * - real_name: The real name of the verified user.
                 * - discord_username: The Discord username of the verified user.
                 * - email: The email address used for verification (Unique).
                 * - verified_at: Timestamp when the user was verified.
                 */
                db.run(`
                    CREATE TABLE IF NOT EXISTS verified_users (
                    user_id TEXT NOT NULL PRIMARY KEY,
                    guild_id TEXT NOT NULL,
                    real_name TEXT NOT NULL,
                    discord_username TEXT NOT NULL,
                    email TEXT NOT NULL UNIQUE,
                    verified_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`);

                /**
                 * active_voice_sessions Table: Tracks current active voice chat sessions for users.
                 * - user_id: Unique identifier for the user.
                 * - guild_id: Unique identifier for the Discord server.
                 * - channel_id: The ID of the voice channel the user is in.
                 * - join_time: Unix timestamp when the user joined the voice channel.
                 * Composite Primary Key: (user_id, guild_id)
                 */
                db.run(`
                    CREATE TABLE IF NOT EXISTS active_voice_sessions (
                    user_id TEXT NOT NULL,
                    guild_id TEXT NOT NULL,
                    channel_id TEXT NOT NULL,
                    join_time INTEGER NOT NULL,
                    PRIMARY KEY (user_id, guild_id)
                )`);

                /**
                 * notices Table: Stores information about scraped notices or announcements.
                 * - title: The title of the notice.
                 * - link: The URL link to the notice (Primary Key).
                 * - date: The date of the notice.
                 * - announced_at: Timestamp when the notice was announced by the bot.
                 */
                db.run(`CREATE TABLE IF NOT EXISTS notices (
                    title TEXT NOT NULL,
                    link TEXT NOT NULL,
                    date TEXT NOT NULL,
                    announced_at INTEGER NOT NULL,
                    PRIMARY KEY (link)
                )`);

                /**
                 * anti_spam_configs Table: Stores anti-spam configuration for each guild.
                 * - guild_id: Unique identifier for the Discord server (Primary Key).
                 * - message_limit: Max messages allowed within the time window.
                 * - time_window_seconds: Time window in seconds for message limit.
                 * - mute_duration_seconds: Duration in seconds for muting spammers.
                 * - kick_threshold: Number of spam offenses before a kick.
                 * - ban_threshold: Number of spam offenses before a ban.
                 */
                db.run(`CREATE TABLE IF NOT EXISTS anti_spam_configs (
                    guild_id TEXT PRIMARY KEY,
                    message_limit INTEGER DEFAULT 5,
                    time_window_seconds INTEGER DEFAULT 5,
                    mute_duration_seconds INTEGER DEFAULT 300,
                    kick_threshold INTEGER DEFAULT 3,
                    ban_threshold INTEGER DEFAULT 5,
                    UNIQUE(guild_id) ON CONFLICT REPLACE
                )`);
                // Migrations for anti_spam_configs: Add new columns if they don't exist
                db.all("PRAGMA table_info(anti_spam_configs)", (err, columns) => {
                    if (err) {
                        console.error("Error checking anti_spam_configs schema:", err.message);
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
                                if (alterErr) {
                                    console.error(`Error adding ${col.name} to anti_spam_configs:`, alterErr.message);
                                } else {
                                    console.log(`Added ${col.name} column to anti_spam_configs.`);
                                }
                            });
                        }
                    });
                });

                /**
                 * faqs Table: Stores frequently asked questions and their answers for each guild.
                 * - id: Auto-incrementing primary key.
                 * - guild_id: The ID of the guild the FAQ belongs to.
                 * - question: The FAQ question (Unique per guild).
                 * - answer: The answer to the FAQ.
                 * - keywords: Optional keywords for searching FAQs.
                 * - created_by: The ID of the user who created the FAQ.
                 * - created_at: Timestamp when the FAQ was created.
                 */
                db.run(`
                    CREATE TABLE IF NOT EXISTS faqs (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        guild_id TEXT NOT NULL,
                        question TEXT NOT NULL,
                        answer TEXT NOT NULL,
                        keywords TEXT,
                        created_by TEXT NOT NULL,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(guild_id, question)
                    )
                `, (err) => {
                    if (err) {
                        console.error('Error creating faqs table:', err.message);
                    } else {
                        console.log('Faqs table checked/created.');
                    }
                });

                // Migrations for 'faqs' table: Add 'keywords' and 'created_by' columns
                db.all("PRAGMA table_info(faqs)", (err, columns) => {
                    if (err) {
                        console.error("Error checking faqs schema:", err.message);
                        return;
                    }
                    const columnNames = Array.isArray(columns) ? columns.map(col => col.name) : [];
                    if (!columnNames.includes("keywords")) {
                        db.run("ALTER TABLE faqs ADD COLUMN keywords TEXT", (alterErr) => {
                            if (alterErr) {
                                console.error("Error adding keywords column to faqs:", alterErr.message);
                            } else {
                                console.log("Added keywords column to faqs.");
                            }
                        });
                    }
                    if (!columnNames.includes("created_by")) {
                        db.run("ALTER TABLE faqs ADD COLUMN created_by TEXT", (alterErr) => {
                            if (alterErr) {
                                console.error("Error adding created_by column to faqs:", alterErr.message);
                            } else {
                                console.log("Added created_by column to faqs.");
                            }
                        });
                    }
                });

                /**
                 * admin_tasks Table: Stores administrative tasks assigned within a guild.
                 * - id: Auto-incrementing primary key.
                 * - guild_id: The ID of the guild the task belongs to.
                 * - creatorId: The ID of the user who created the task.
                 * - taskDescription: A description of the task.
                 * - assigned_to: The ID of the user assigned to the task (optional).
                 * - status: The current status of the task (e.g., 'pending', 'completed').
                 * - createdAt: Unix timestamp when the task was created.
                 * - due_date: Due date for the task.
                 */
                db.run(`
                    CREATE TABLE IF NOT EXISTS admin_tasks (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        guild_id TEXT NOT NULL,
                        creatorId TEXT NOT NULL,
                        taskDescription TEXT,
                        description TEXT, 
                        assigned_to TEXT,
                        status TEXT DEFAULT 'pending',
                        createdAt INTEGER,
                        due_date DATETIME
                    )
                `, (err) => {
                    if (err) {
                        console.error('Error creating admin_tasks table:', err.message);
                    } else {
                        console.log('Admin tasks table checked/created.');
                    }
                });
                /**
                 * rss_feeds Table: Stores RSS feed subscriptions for each guild.
                 * - id: Auto-incrementing primary key.
                 * - guild_id: The ID of the guild the subscription belongs to.
                 * - channel_id: The ID of the channel where updates will be posted.
                 * - url: The URL of the RSS feed.
                 * - last_guid: The GUID of the last item posted to prevent duplicates.
                 * - title: The title of the RSS feed (NEWLY ADDED).
                 */
                db.run(`
                    CREATE TABLE IF NOT EXISTS rss_feeds (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        guild_id TEXT NOT NULL,
                        channel_id TEXT NOT NULL,
                        url TEXT NOT NULL,
                        last_guid TEXT,
                        title TEXT, -- ADDED THIS LINE
                        UNIQUE(guild_id, channel_id, url)
                    )
                `, (err) => {
                    if (err) {
                        console.error('Error creating rss_feeds table:', err.message);
                    } else {
                        console.log('Rss_feeds table checked/created.');
                    }
                });
                db.all("PRAGMA table_info(rss_feeds)", (err, columns) => {
                    if (err) {
                        console.error("Error checking rss_feeds schema:", err.message);
                        return;
                    }
                    const columnNames = Array.isArray(columns) ? columns.map(col => col.name) : [];
                    if (!columnNames.includes("title")) {
                        db.run("ALTER TABLE rss_feeds ADD COLUMN title TEXT", (alterErr) => {
                            if (alterErr) {
                                console.error("Error adding title column to rss_feeds:", alterErr.message);
                            } else {
                                console.log("Added title column to rss_feeds.");
                            }
                        });
                    }
                });
                // Migrations for 'admin_tasks' table: Ensure correct column names and types
                db.all("PRAGMA table_info(admin_tasks)", (err, columns) => {
                    if (err) {
                        console.error("Error checking admin_tasks schema:", err.message);
                        return;
                    }
                    const columnNames = Array.isArray(columns) ? columns.map(col => col.name) : [];
                    
                    // Add 'creatorId' column
                    if (!columnNames.includes("creatorId")) {
                        db.run("ALTER TABLE admin_tasks ADD COLUMN creatorId TEXT", (alterErr) => {
                            if (alterErr) {
                                console.error("Error adding creatorId column to admin_tasks:", alterErr.message);
                            } else {
                                console.log("Added creatorId column to admin_tasks.");
                            }
                        });
                    }
                    
                    // Add/Rename 'taskDescription' column (from 'task_name')
                    if (!columnNames.includes("taskDescription")) {
                        db.run("ALTER TABLE admin_tasks ADD COLUMN taskDescription TEXT", (alterErr) => {
                            if (alterErr) {
                                console.error("Error adding taskDescription column to admin_tasks:", alterErr.message);
                            } else {
                                console.log("Added taskDescription column to admin_tasks.");
                            }
                        });
                    } else if (columnNames.includes("task_name") && !columnNames.includes("taskDescription")) {
                        db.run("ALTER TABLE admin_tasks RENAME COLUMN task_name TO taskDescription", (alterErr) => {
                            if (alterErr) {
                                console.error("Error renaming task_name to taskDescription in admin_tasks:", alterErr.message);
                            } else {
                                console.log("Renamed task_name to taskDescription in admin_tasks.");
                            }
                        });
                    }

                    // Add/Rename 'createdAt' column (from 'created_at')
                    if (!columnNames.includes("createdAt")) {
                        db.run("ALTER TABLE admin_tasks ADD COLUMN createdAt INTEGER", (alterErr) => {
                            if (alterErr) {
                                console.error("Error adding createdAt column to admin_tasks:", alterErr.message);
                            } else {
                                console.log("Added createdAt column to admin_tasks.");
                            }
                        });
                    } else if (columnNames.includes("created_at") && !columnNames.includes("createdAt")) {
                        db.run("ALTER TABLE admin_tasks RENAME COLUMN created_at TO createdAt", (alterErr) => {
                            if (alterErr) {
                                console.error("Error renaming created_at to createdAt in admin_tasks:", alterErr.message);
                            } else {
                                console.log("Renamed created_at to createdAt in admin_tasks.");
                            }
                        });
                    }

                    // Ensure 'guild_id' and 'guildId' consistency (handling potential past naming issues)
                    if (!columnNames.includes("guildId") && columnNames.includes("guild_id")) {
                        db.run("ALTER TABLE admin_tasks ADD COLUMN guildId TEXT", (alterErr) => {
                            if (alterErr) {
                                console.error("Error adding guildId to admin_tasks:", alterErr.message);
                            } else {
                                console.log("Added guildId column to admin_tasks.");
                                db.run("UPDATE admin_tasks SET guildId = guild_id WHERE guildId IS NULL", (updateErr) => {
                                    if (updateErr) {
                                        console.error("Error copying data from guild_id to guildId:", updateErr.message);
                                    } else {
                                        console.log("Copied data from guild_id to guildId in admin_tasks.");
                                    }
                                });
                            }
                        });
                    } else if (!columnNames.includes("guild_id") && columnNames.includes("guildId")) {
                         db.run("ALTER TABLE admin_tasks ADD COLUMN guild_id TEXT", (alterErr) => {
                            if (alterErr) {
                                console.error("Error adding guild_id to admin_tasks:", alterErr.message);
                            } else {
                                console.log("Added guild_id column to admin_tasks.");
                                db.run("UPDATE admin_tasks SET guild_id = guildId WHERE guild_id IS NULL", (updateErr) => {
                                    if (updateErr) {
                                        console.error("Error copying data from guildId to guild_id:", updateErr.message);
                                    } else {
                                        console.log("Copied data from guildId to guild_id in admin_tasks.");
                                    }
                                });
                            }
                        });
                    } else if (!columnNames.includes("guild_id") && !columnNames.includes("guildId")) {
                        console.warn("Neither 'guild_id' nor 'guildId' found in admin_tasks. This indicates a potential issue with initial table creation.");
                    }
                });

                /**
                 * moderation_actions Table: Logs various moderation actions performed by the bot.
                 * - id: Auto-incrementing primary key.
                 * - action_type: Type of moderation action (e.g., 'kick', 'ban', 'timeout', 'mute', 'deafen', 'reset_warnings').
                 * - moderator_id: ID of the moderator who performed the action.
                 * - target_user_id: ID of the user targeted by the action.
                 * - guild_id: ID of the guild where the action occurred.
                 * - timestamp: Unix timestamp when the action occurred.
                 * - reason: Reason for the moderation action.
                 */
                db.run(`
                    CREATE TABLE IF NOT EXISTS moderation_actions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        action_type TEXT NOT NULL,
                        moderator_id TEXT NOT NULL,
                        target_user_id TEXT NOT NULL,
                        guild_id TEXT NOT NULL,
                        timestamp INTEGER NOT NULL,
                        reason TEXT
                    )
                `, (err) => {
                    if (err) {
                        console.error('Error creating moderation_actions table:', err.message);
                    } else {
                        console.log('Moderation actions table checked/created.');
                    }
                });

                /**
                 * reputation Table: Stores reputation points for users in each guild.
                 * - user_id: Unique identifier for the user.
                 * - guild_id: Unique identifier for the Discord server.
                 * - reputation_points: The total reputation points for the user in that guild.
                 * Composite Primary Key: (user_id, guild_id)
                 */
                db.run(`
                    CREATE TABLE IF NOT EXISTS reputation (
                        user_id TEXT NOT NULL,
                        guild_id TEXT NOT NULL,
                        reputation_points INTEGER DEFAULT 0,
                        PRIMARY KEY (user_id, guild_id)
                    )
                `, (err) => {
                    if (err) {
                        console.error('Error creating reputation table:', err.message);
                    } else {
                        console.log('Reputation table checked/created.');
                    }
                });

                /**
                 * mod_cooldowns Table: Manages cooldowns for specific moderator commands.
                 * - command_name: The name of the command (e.g., 'repu').
                 * - user_id: The ID of the moderator using the command.
                 * - last_used_at: Unix timestamp when the command was last used by the moderator.
                 * Composite Primary Key: (command_name, user_id)
                 */
                db.run(`
                    CREATE TABLE IF NOT EXISTS mod_cooldowns (
                        command_name TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        last_used_at INTEGER NOT NULL,
                        PRIMARY KEY (command_name, user_id)
                    )
                `, (err) => {
                    if (err) {
                        console.error('Error creating mod_cooldowns table:', err.message);
                    } else {
                        console.log('Mod cooldowns table checked/created.');
                    }
                });

                console.log('All database tables checked/created and schema updated.');
                resolve(db); // Resolve the promise with the database object
            });
        });
    });
}

export { initializeDatabase, db };