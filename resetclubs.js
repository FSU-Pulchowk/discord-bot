// scripts/resetAllClubs.js
/**
 * DEVELOPMENT/TESTING ONLY - Reset all club-related database tables
 * 
 * WARNING: This script will DELETE ALL club data including:
 * - All clubs
 * - All club members
 * - All club events
 * - All event participants
 * - All club join requests
 * - All club announcements
 * - All club resources
 * - All club settings
 * - All club audit logs
 * - All club form submissions
 * - All club Excel sync records
 * 
 * Usage: node scripts/resetAllClubs.js [--confirm]
 */

import sqlite3 from 'sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, 'bot.db');

// ANSI color codes for better output
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m'
};

/**
 * All club-related tables to reset
 */
const CLUB_TABLES = [
    'event_participants',           // Must be deleted first (foreign key to club_events)
    'club_events',                  // Must be before clubs (foreign key)
    'club_members',                 // Must be before clubs (foreign key)
    'club_join_requests',           // Must be before clubs (foreign key)
    'club_announcements',           // Must be before clubs (foreign key)
    'club_resources',               // Must be before clubs (foreign key)
    'club_settings',                // Must be before clubs (foreign key)
    'club_audit_log',               // Can reference clubs
    'club_form_submissions',        // Independent
    'club_excel_sync',              // Independent
    'clubs'                         // Delete last (parent table)
];

/**
 * Log with color
 */
function log(message, color = 'white') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Prompt user for confirmation
 */
async function promptConfirmation() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question(
            `${colors.red}⚠️  WARNING: This will DELETE ALL club data!\n` +
            `${colors.yellow}Are you sure you want to continue? Type 'yes' to confirm: ${colors.reset}`,
            (answer) => {
                rl.close();
                resolve(answer.toLowerCase() === 'yes');
            }
        );
    });
}

/**
 * Get row count for a table
 */
async function getRowCount(db, tableName) {
    return new Promise((resolve, reject) => {
        db.get(`SELECT COUNT(*) as count FROM ${tableName}`, [], (err, row) => {
            if (err) {
                // Table might not exist
                resolve(0);
            } else {
                resolve(row?.count || 0);
            }
        });
    });
}

/**
 * Delete all rows from a table
 */
async function resetTable(db, tableName) {
    return new Promise((resolve, reject) => {
        db.run(`DELETE FROM ${tableName}`, [], function(err) {
            if (err) reject(err);
            else resolve(this.changes);
        });
    });
}

/**
 * Reset SQLite sequence for autoincrement
 */
async function resetSequence(db, tableName) {
    return new Promise((resolve, reject) => {
        db.run(
            `DELETE FROM sqlite_sequence WHERE name = ?`,
            [tableName],
            (err) => {
                if (err) reject(err);
                else resolve();
            }
        );
    });
}

/**
 * Check if a table exists
 */
async function tableExists(db, tableName) {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
            [tableName],
            (err, row) => {
                if (err) reject(err);
                else resolve(!!row);
            }
        );
    });
}

/**
 * Main reset function
 */
async function resetAllClubs() {
    log('\n╔══════════════════════════════════════════════════════════╗', 'cyan');
    log('║        CLUB DATABASE RESET SCRIPT (DEV/TEST ONLY)       ║', 'cyan');
    log('╚══════════════════════════════════════════════════════════╝\n', 'cyan');

    // Check for --confirm flag
    const hasConfirmFlag = process.argv.includes('--confirm');

    if (!hasConfirmFlag) {
        const confirmed = await promptConfirmation();
        if (!confirmed) {
            log('\n❌ Reset cancelled by user.', 'yellow');
            process.exit(0);
        }
    } else {
        log('⚡ Running with --confirm flag, skipping prompt...', 'yellow');
    }

    log('\n🔌 Connecting to database...', 'blue');
    
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
        if (err) {
            log(`\n❌ Error connecting to database: ${err.message}`, 'red');
            process.exit(1);
        }
    });

    try {
        // Get statistics before reset
        log('\n📊 Collecting statistics before reset...', 'blue');
        const statsBefore = {};
        
        for (const table of CLUB_TABLES) {
            const exists = await tableExists(db, table);
            if (exists) {
                const count = await getRowCount(db, table);
                statsBefore[table] = count;
                log(`   ${table}: ${count} rows`, 'white');
            } else {
                log(`   ${table}: table does not exist`, 'yellow');
                statsBefore[table] = -1;
            }
        }

        // Disable foreign keys temporarily for easier deletion
        log('\n🔓 Disabling foreign key constraints...', 'blue');
        await new Promise((resolve, reject) => {
            db.run('PRAGMA foreign_keys = OFF', (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Begin transaction
        log('🔄 Starting transaction...', 'blue');
        await new Promise((resolve, reject) => {
            db.run('BEGIN TRANSACTION', (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Reset each table
        log('\n🗑️  Deleting data from tables...', 'magenta');
        let totalDeleted = 0;

        for (const table of CLUB_TABLES) {
            if (statsBefore[table] === -1) {
                log(`   ⏭️  Skipping ${table} (doesn't exist)`, 'yellow');
                continue;
            }

            try {
                const deleted = await resetTable(db, table);
                totalDeleted += deleted;
                log(`   ✅ ${table}: deleted ${deleted} rows`, 'green');

                // Reset autoincrement sequence
                await resetSequence(db, table);
                log(`   🔄 ${table}: reset autoincrement sequence`, 'cyan');
            } catch (err) {
                log(`   ❌ ${table}: error - ${err.message}`, 'red');
            }
        }

        // Commit transaction
        log('\n💾 Committing changes...', 'blue');
        await new Promise((resolve, reject) => {
            db.run('COMMIT', (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Re-enable foreign keys
        log('🔒 Re-enabling foreign key constraints...', 'blue');
        await new Promise((resolve, reject) => {
            db.run('PRAGMA foreign_keys = ON', (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Verify reset
        log('\n🔍 Verifying reset...', 'blue');
        let allClear = true;

        for (const table of CLUB_TABLES) {
            if (statsBefore[table] === -1) continue;

            const count = await getRowCount(db, table);
            if (count > 0) {
                log(`   ⚠️  ${table}: still has ${count} rows!`, 'red');
                allClear = false;
            } else {
                log(`   ✅ ${table}: empty`, 'green');
            }
        }

        // Summary
        log('\n╔══════════════════════════════════════════════════════════╗', 'cyan');
        log('║                    RESET SUMMARY                         ║', 'cyan');
        log('╚══════════════════════════════════════════════════════════╝', 'cyan');
        log(`\n📊 Total rows deleted: ${totalDeleted}`, 'white');
        log(`✅ Status: ${allClear ? 'All tables cleared successfully!' : 'Some tables still have data'}`, allClear ? 'green' : 'yellow');
        
        if (allClear) {
            log('\n🎉 All club data has been reset successfully!', 'green');
            log('You can now start fresh with club registrations and events.\n', 'white');
        } else {
            log('\n⚠️  Some tables could not be fully cleared. Check the output above.\n', 'yellow');
        }

    } catch (error) {
        log(`\n❌ Fatal error: ${error.message}`, 'red');
        console.error(error);
        
        // Try to rollback
        try {
            await new Promise((resolve, reject) => {
                db.run('ROLLBACK', (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            log('🔄 Transaction rolled back', 'yellow');
        } catch (rollbackErr) {
            log(`❌ Rollback failed: ${rollbackErr.message}`, 'red');
        }
        
        process.exit(1);
    } finally {
        // Close database
        db.close((err) => {
            if (err) {
                log(`\n❌ Error closing database: ${err.message}`, 'red');
            } else {
                log('🔌 Database connection closed', 'blue');
            }
        });
    }
}

/**
 * Display help information
 */
function showHelp() {
    console.log(`
${colors.cyan}╔══════════════════════════════════════════════════════════╗
║        CLUB DATABASE RESET SCRIPT (DEV/TEST ONLY)       ║
╚══════════════════════════════════════════════════════════╝${colors.reset}

${colors.yellow}⚠️  WARNING: This script will DELETE ALL club data!${colors.reset}

${colors.white}Usage:${colors.reset}
  node scripts/resetAllClubs.js           ${colors.cyan}# Interactive mode with confirmation${colors.reset}
  node scripts/resetAllClubs.js --confirm ${colors.cyan}# Skip confirmation prompt${colors.reset}
  node scripts/resetAllClubs.js --help    ${colors.cyan}# Show this help message${colors.reset}

${colors.white}What this script does:${colors.reset}
  ${colors.green}✓${colors.reset} Deletes all rows from club-related tables
  ${colors.green}✓${colors.reset} Resets autoincrement sequences
  ${colors.green}✓${colors.reset} Preserves table structure
  ${colors.green}✓${colors.reset} Uses transactions for safety
  ${colors.green}✓${colors.reset} Verifies the reset was successful

${colors.white}Tables that will be reset:${colors.reset}
  • event_participants
  • club_events
  • club_members
  • club_join_requests
  • club_announcements
  • club_resources
  • club_settings
  • club_audit_log
  • club_form_submissions
  • club_excel_sync
  • clubs

${colors.red}⚠️  This is IRREVERSIBLE! Use only for testing/development!${colors.reset}
`);
}

// Handle CLI arguments
if (process.argv.includes('--help') || process.argv.includes('-h')) {
    showHelp();
    process.exit(0);
}

// Run the reset
resetAllClubs().catch((error) => {
    log(`\n❌ Unhandled error: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
});