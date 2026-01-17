// scripts/fixClubModeratorRoles.js

import sqlite3 from 'sqlite3';
import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, '../../bot.db');

// Initialize database connection
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
    if (err) {
        console.error('❌ Error connecting to database:', err);
        process.exit(1);
    }
    console.log('✅ Connected to database\n');
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

async function fixClubModeratorRoles() {
    console.log('🔧 Starting club moderator roles fix...\n');

    try {
        // Get all active clubs without moderator roles
        const clubs = await new Promise((resolve, reject) => {
            db.all(
                `SELECT c.id, c.guild_id, c.name, c.role_id, c.moderator_role_id
                 FROM clubs c
                 WHERE c.status = 'active' 
                 AND (c.moderator_role_id IS NULL OR c.moderator_role_id = '')`,
                [],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        if (clubs.length === 0) {
            console.log('✅ All clubs already have moderator roles!\n');
            db.close();
            process.exit(0);
        }

        console.log(`📋 Found ${clubs.length} clubs needing moderator roles:\n`);
        clubs.forEach(club => {
            console.log(`   • ${club.name} (ID: ${club.id}) in guild ${club.guild_id}`);
        });
        console.log('');

        let fixed = 0;
        let failed = 0;

        for (const club of clubs) {
            try {
                console.log(`🔨 Processing: ${club.name}...`);

                // Get guild
                const guild = await client.guilds.fetch(club.guild_id);
                if (!guild) {
                    console.log(`   ❌ Guild not found: ${club.guild_id}`);
                    failed++;
                    continue;
                }

                // Get club role for color reference
                let clubRole = null;
                if (club.role_id) {
                    clubRole = await guild.roles.fetch(club.role_id).catch(() => null);
                }

                if (!clubRole) {
                    console.log(`   ⚠️  Club role not found, using default color`);
                }

                // Create moderator role
                const modRole = await guild.roles.create({
                    name: `${club.name} - Moderator`,
                    color: clubRole?.color || 0x5865F2,
                    hoist: true,
                    mentionable: true,
                    reason: `Auto-fix: Creating missing moderator role for ${club.name}`
                });

                console.log(`   ✅ Created moderator role: ${modRole.name} (${modRole.id})`);

                // Update database
                await new Promise((resolve, reject) => {
                    db.run(
                        `UPDATE clubs SET moderator_role_id = ?, updated_at = ? WHERE id = ?`,
                        [modRole.id, Math.floor(Date.now() / 1000), club.id],
                        (err) => {
                            if (err) reject(err);
                            else resolve();
                        }
                    );
                });

                console.log(`   ✅ Database updated\n`);
                fixed++;

            } catch (error) {
                console.error(`   ❌ Error processing ${club.name}:`, error.message);
                failed++;
            }
        }

        console.log('\n' + '='.repeat(50));
        console.log('📊 Summary:');
        console.log(`   ✅ Fixed: ${fixed} clubs`);
        console.log(`   ❌ Failed: ${failed} clubs`);
        console.log(`   📋 Total: ${clubs.length} clubs`);
        console.log('='.repeat(50) + '\n');

        if (fixed > 0) {
            console.log('🎉 Success! All clubs now have moderator roles.');
        }

        db.close();
        process.exit(0);

    } catch (error) {
        console.error('❌ Fatal error:', error);
        db.close();
        process.exit(1);
    }
}

// Wait for bot to be ready
client.once('ready', async () => {
    console.log(`🤖 Bot ready as ${client.user.tag}\n`);
    await fixClubModeratorRoles();
});

// Login
client.login(process.env.BOT_TOKEN);