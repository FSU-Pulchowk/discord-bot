#!/usr/bin/env node
// Quick fix script for adding missing updated_at column to club_members table
// Run this script once to fix the database schema

import { db, initializeDatabase } from '../database.js';
import { log } from '../utils/debug.js';

console.log('🔧 Starting database schema fix...\n');

// Initialize database (this will create/update tables)
await initializeDatabase();

// Give it a moment to complete
await new Promise(resolve => setTimeout(resolve, 1000));

// Verify the fix
db.all("PRAGMA table_info(club_members)", [], (err, columns) => {
    if (err) {
        console.error('❌ Error checking schema:', err);
        process.exit(1);
    }

    console.log('\n📋 club_members table columns:');
    const hasUpdatedAt = columns.some(col => col.name === 'updated_at');

    columns.forEach(col => {
        const marker = col.name === 'updated_at' ? '✅ ' : '   ';
        console.log(`${marker}${col.name} (${col.type})`);
    });

    if (hasUpdatedAt) {
        console.log('\n✅ SUCCESS! The "updated_at" column is present.');
        console.log('✅ You can now use the /clubmod add command.\n');
        process.exit(0);
    } else {
        console.log('\n❌ WARNING: "updated_at" column is still missing.');
        console.log('   Try manually adding it with SQLite:\n');
        console.log('   sqlite3 bot.db "ALTER TABLE club_members ADD COLUMN updated_at INTEGER DEFAULT (strftime(\'%s\', \'now\'));"\n');
        process.exit(1);
    }
});
