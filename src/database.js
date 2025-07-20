import sqlite3 from 'sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, '../bot.db');

let db;

/**
 * Initializes and connects to the SQLite database, creating tables if they don't exist.
 * @returns {Promise<sqlite3.Database>} A promise that resolves with the database instance.
 */
async function initializeDatabase() {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('Error connecting to database:', err.message);
                return reject(err);
            }
            console.log('Connected to the SQLite database.');

            db.serialize(() => {
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
                    upvotes INTEGER DEFAULT 0,
                    downvotes INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    reviewed_by TEXT,
                    reviewed_at DATETIME,
                    reason TEXT
                )`);
                db.run(`CREATE TABLE IF NOT EXISTS birthdays (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    guild_id TEXT NOT NULL,
                    user_id TEXT NOT NULL UNIQUE,
                    month INTEGER NOT NULL,
                    day INTEGER NOT NULL,
                    year INTEGER,
                    set_by TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(guild_id, user_id) ON CONFLICT REPLACE
                )`);
                db.run(`CREATE TABLE IF NOT EXISTS anti_spam_configs (
                    guild_id TEXT PRIMARY KEY,
                    message_limit INTEGER DEFAULT 5,
                    time_window_seconds INTEGER DEFAULT 5,
                    mute_duration_seconds INTEGER DEFAULT 300,
                    kick_threshold INTEGER DEFAULT 3,
                    ban_threshold INTEGER DEFAULT 5
                )`);
                db.run(`CREATE TABLE IF NOT EXISTS user_stats (
                    user_id TEXT NOT NULL,
                    guild_id TEXT NOT NULL,
                    messages_sent INTEGER DEFAULT 0,
                    voice_time_minutes INTEGER DEFAULT 0,
                    last_message_at INTEGER,
                    PRIMARY KEY (user_id, guild_id)
                )`);
                db.run(`CREATE TABLE IF NOT EXISTS admin_tasks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    guildId TEXT NOT NULL,
                    creatorId TEXT NOT NULL,
                    taskDescription TEXT NOT NULL,
                    status TEXT DEFAULT 'pending',
                    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                    assigneeId TEXT,
                    completedAt DATETIME,
                    completedBy TEXT
                )`);
                db.run(`CREATE TABLE IF NOT EXISTS faqs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    guild_id TEXT NOT NULL,
                    question TEXT NOT NULL,
                    answer TEXT NOT NULL,
                    keywords TEXT,
                    created_by TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`);
                db.run(`CREATE TABLE IF NOT EXISTS guild_configs (
                    guild_id TEXT PRIMARY KEY,
                    welcome_message_content TEXT,
                    welcome_channel_id TEXT,
                    send_welcome_as_dm BOOLEAN DEFAULT 0,
                    farewell_channel_id TEXT
                )`);
                db.run(`CREATE TABLE IF NOT EXISTS warnings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    userId TEXT NOT NULL,
                    guildId TEXT NOT NULL,
                    moderatorId TEXT NOT NULL,
                    reason TEXT,
                    timestamp INTEGER
                )`);
                db.run(`CREATE TABLE IF NOT EXISTS verified_users (
                    user_id TEXT NOT NULL PRIMARY KEY,
                    guild_id TEXT NOT NULL,
                    real_name TEXT NOT NULL,
                    discord_username TEXT NOT NULL,
                    email TEXT NOT NULL UNIQUE,
                    verified_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`);
                db.run(`CREATE TABLE IF NOT EXISTS active_voice_sessions (
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
                console.log('All database tables checked/created.');
                resolve(db);
            });
        });
    });
}

export { initializeDatabase, db };