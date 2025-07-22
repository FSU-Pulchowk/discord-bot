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


                console.log('All database tables checked/created and schema updated.');
                resolve(db);
            });
        });
    });
}

export { initializeDatabase, db };