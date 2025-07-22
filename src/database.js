import sqlite3 from 'sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, '../bot.db');

let db;

async function initializeDatabase() {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
            if (err) {
                console.error('Error connecting to database:', err.message);
                return reject(err);
            }
            console.log('Connected to the SQLite database.');

            db.serialize(() => {
                db.run(`CREATE TABLE IF NOT EXISTS guild_configs (
                    guild_id TEXT PRIMARY KEY,
                    welcome_message_content TEXT,
                    welcome_channel_id TEXT,
                    send_welcome_as_dm BOOLEAN DEFAULT 0,
                    farewell_channel_id TEXT,
                    UNIQUE(guild_id) ON CONFLICT REPLACE
                )`);

                db.all("PRAGMA table_info(guild_configs)", (err, columns) => {
                    if (err) {
                        console.error("Error checking guild_configs schema for farewell_channel_id:", err.message);
                        return;
                    }
                    const columnNames = Array.isArray(columns) ? columns.map(col => col.name) : [];
                    if (!columnNames.includes("farewell_channel_id")) {
                        db.run("ALTER TABLE guild_configs ADD COLUMN farewell_channel_id TEXT", (alterErr) => {
                            if (alterErr) {
                                console.error("Error adding farewell_channel_id to guild_configs:", alterErr.message);
                            } else {
                                console.log("Added farewell_channel_id column to guild_configs.");
                            }
                        });
                    }
                });

                db.run(`CREATE TABLE IF NOT EXISTS reaction_roles (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    guild_id TEXT NOT NULL,
                    message_id TEXT NOT NULL,
                    emoji TEXT NOT NULL,
                    role_id TEXT NOT NULL,
                    UNIQUE(message_id, emoji, guild_id) ON CONFLICT REPLACE
                )`);

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

                db.run(`CREATE TABLE IF NOT EXISTS user_stats (
                    user_id TEXT NOT NULL,
                    guild_id TEXT NOT NULL,
                    messages_sent INTEGER DEFAULT 0,
                    voice_time_minutes REAL DEFAULT 0.0,
                    last_message_at INTEGER,
                    PRIMARY KEY (user_id, guild_id)
                )`);

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

                db.run(`
                    CREATE TABLE IF NOT EXISTS warnings (id INTEGER PRIMARY KEY AUTOINCREMENT,
                    userId TEXT NOT NULL,
                    guildId TEXT NOT NULL,
                    moderatorId TEXT NOT NULL,
                    reason TEXT,
                    timestamp INTEGER
                )`);

                db.run(`
                    CREATE TABLE IF NOT EXISTS verified_users (
                    user_id TEXT NOT NULL PRIMARY KEY,
                    guild_id TEXT NOT NULL,
                    real_name TEXT NOT NULL,
                    discord_username TEXT NOT NULL,
                    email TEXT NOT NULL UNIQUE,
                    verified_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`);

                db.run(`
                    CREATE TABLE IF NOT EXISTS active_voice_sessions (
                    user_id TEXT NOT NULL,
                    guild_id TEXT NOT NULL,
                    channel_id TEXT NOT NULL,
                    join_time INTEGER NOT NULL,
                    PRIMARY KEY (user_id, guild_id)
                )`);

                db.run(`CREATE TABLE IF NOT EXISTS notices (
                    title TEXT NOT NULL,
                    link TEXT NOT NULL,
                    date TEXT NOT NULL,
                    announced_at INTEGER NOT NULL,
                    PRIMARY KEY (link)
                )`);

                db.run(`CREATE TABLE IF NOT EXISTS anti_spam_configs (
                    guild_id TEXT PRIMARY KEY,
                    message_limit INTEGER DEFAULT 5,
                    time_window_seconds INTEGER DEFAULT 5,
                    mute_duration_seconds INTEGER DEFAULT 300,
                    kick_threshold INTEGER DEFAULT 3,
                    ban_threshold INTEGER DEFAULT 5,
                    UNIQUE(guild_id) ON CONFLICT REPLACE
                )`);
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

                // --- Add migration for 'keywords' column in 'faqs' table ---
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
                    // --- Add migration for 'created_by' column in 'faqs' table ---
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

                db.run(`
                    CREATE TABLE IF NOT EXISTS admin_tasks (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        guild_id TEXT NOT NULL,
                        creatorId TEXT NOT NULL,
                        taskDescription TEXT, -- Renamed from 'task_name' to match addTask.js
                        description TEXT, 
                        assigned_to TEXT,
                        status TEXT DEFAULT 'pending',
                        createdAt INTEGER, -- Changed to INTEGER to match Date.now() in addTask.js
                        due_date DATETIME
                    )
                `, (err) => {
                    if (err) {
                        console.error('Error creating admin_tasks table:', err.message);
                    } else {
                        console.log('Admin tasks table checked/created.');
                    }
                });

                // --- Add migration for 'creatorId' column in 'admin_tasks' table ---
                db.all("PRAGMA table_info(admin_tasks)", (err, columns) => {
                    if (err) {
                        console.error("Error checking admin_tasks schema:", err.message);
                        return;
                    }
                    const columnNames = Array.isArray(columns) ? columns.map(col => col.name) : [];
                    if (!columnNames.includes("creatorId")) {
                        db.run("ALTER TABLE admin_tasks ADD COLUMN creatorId TEXT", (alterErr) => {
                            if (alterErr) {
                                console.error("Error adding creatorId column to admin_tasks:", alterErr.message);
                            } else {
                                console.log("Added creatorId column to admin_tasks.");
                            }
                        });
                    }
                    // --- Add migration for 'taskDescription' column in 'admin_tasks' table ---
                    if (!columnNames.includes("taskDescription")) {
                        db.run("ALTER TABLE admin_tasks ADD COLUMN taskDescription TEXT", (alterErr) => {
                            if (alterErr) {
                                console.error("Error adding taskDescription column to admin_tasks:", alterErr.message);
                            } else {
                                console.log("Added taskDescription column to admin_tasks.");
                            }
                        });
                    } else if (columnNames.includes("task_name") && !columnNames.includes("taskDescription")) {
                        // If old 'task_name' exists but 'taskDescription' is missing, rename it
                        db.run("ALTER TABLE admin_tasks RENAME COLUMN task_name TO taskDescription", (alterErr) => {
                            if (alterErr) {
                                console.error("Error renaming task_name to taskDescription in admin_tasks:", alterErr.message);
                            } else {
                                console.log("Renamed task_name to taskDescription in admin_tasks.");
                            }
                        });
                    }

                    // --- Add migration for 'createdAt' column in 'admin_tasks' table ---
                    if (!columnNames.includes("createdAt")) {
                        db.run("ALTER TABLE admin_tasks ADD COLUMN createdAt INTEGER", (alterErr) => {
                            if (alterErr) {
                                console.error("Error adding createdAt column to admin_tasks:", alterErr.message);
                            } else {
                                console.log("Added createdAt column to admin_tasks.");
                                // Optional: If 'created_at' (snake_case) exists and 'createdAt' (camelCase) is new,
                                // you might want to copy data from 'created_at' to 'createdAt'.
                                // For now, we'll just add the column.
                            }
                        });
                    } else if (columnNames.includes("created_at") && !columnNames.includes("createdAt")) {
                        // If old 'created_at' exists but 'createdAt' is missing, rename it
                        db.run("ALTER TABLE admin_tasks RENAME COLUMN created_at TO createdAt", (alterErr) => {
                            if (alterErr) {
                                console.error("Error renaming created_at to createdAt in admin_tasks:", alterErr.message);
                            } else {
                                console.log("Renamed created_at to createdAt in admin_tasks.");
                            }
                        });
                    }

                    // --- Add migration for guildId column in admin_tasks if it doesn't exist (from previous fix) ---
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


                console.log('All database tables checked/created and schema updated.');
                resolve(db);
            });
        });
    });
}

export { initializeDatabase, db };