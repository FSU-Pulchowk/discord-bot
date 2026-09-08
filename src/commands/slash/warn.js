import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
    cleanUserMessagesAcrossGuild,
    cleanRecentUserMessagesDeduplicated,
    assignServerBanRole,
    LIGHT_BAN_ROLE_ID
} from '../../utils/moderationUtils.js';

export const data = new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warns a user or resets all warnings for a user.')
    .addUserOption(option =>
        option.setName('target_user')
            .setDescription('The user to warn or reset warnings for')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('reason')
            .setDescription('Reason for the warning or reset (optional)')
            .setRequired(false))
    .addBooleanOption(option =>
        option.setName('reset_warnings')
            .setDescription('Set to TRUE to reset all warnings for the target user (requires Manage Server permission).')
            .setRequired(false))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.KickMembers); 

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    const targetUser = interaction.options.getMember('target_user');
    const reason = interaction.options.getString('reason') || 'No reason provided.';
    const resetWarnings = interaction.options.getBoolean('reset_warnings') || false;

    const guildId = interaction.guild.id;
    const moderatorId = interaction.user.id;
    const db = interaction.client.db;

    if (!targetUser) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ Please specify a user.")], ephemeral: true });
    }
    if (targetUser.id === interaction.client.user.id) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ I cannot be moderated by this command.")], ephemeral: true });
    }
    if (targetUser.id === interaction.guild.ownerId && interaction.user.id !== interaction.guild.ownerId) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription("❌ Cannot moderate the server owner.")], ephemeral: true });
    }
    if (!resetWarnings && !interaction.guild.members.me.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription("❌ I do not have sufficient permissions ('Moderate Members') to perform timeouts. Please grant me 'Moderate Members' permission.")], ephemeral: true });
    }
    if (targetUser.roles.highest.position >= interaction.member.roles.highest.position && interaction.user.id !== interaction.guild.ownerId) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription("❌ Cannot moderate a user with a role equal to or higher than your own.")], ephemeral: true });
    }
    if (targetUser.roles.highest.position >= interaction.guild.members.me.roles.highest.position) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription("❌ I cannot moderate this user because their highest role is equal to or higher than my highest role. Please move my role higher.")], ephemeral: true });
    }
    if (!resetWarnings && targetUser.user.bot) { 
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ You cannot warn a bot.")], ephemeral: true });
    }
    if (resetWarnings) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return interaction.reply({ content: '❌ You do not have permission to reset warnings. You need `Manage Server` permission.', ephemeral: true });
        }
        if (targetUser.id === interaction.user.id) {
            return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ You cannot reset warnings for yourself.")], ephemeral: true });
        }
    } else {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
            return interaction.reply({ content: '❌ You do not have permission to warn users. You need `Kick Members` permission.', ephemeral: true });
        }
        if (targetUser.id === interaction.user.id) {
            return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ You cannot warn yourself.")], ephemeral: true });
        }
    }
    const confirmButton = new ButtonBuilder()
        .setCustomId('confirm_warn')
        .setLabel('Confirm')
        .setStyle(ButtonStyle.Danger); 

    const cancelButton = new ButtonBuilder()
        .setCustomId('cancel_warn')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary); 

    const row = new ActionRowBuilder()
        .addComponents(cancelButton, confirmButton);

    const confirmationEmbed = new EmbedBuilder()
        .setColor('#FFC107')
        .setTitle('Confirmation Needed')
        .setDescription(`Are you sure you want to ${resetWarnings ? 'reset all warnings for' : 'warn'} **${targetUser.user.tag}**?`)
        .addFields(
            { name: 'Action', value: resetWarnings ? 'Reset Warnings' : 'Issue Warning', inline: true },
            { name: 'Target User', value: targetUser.user.tag, inline: true },
            { name: 'Reason', value: reason }
        )
        .setFooter({ text: 'This message will expire in 30 seconds.' })
        .setTimestamp();

    const reply = await interaction.reply({
        embeds: [confirmationEmbed],
        components: [row],
        ephemeral: true,
        fetchReply: true, 
    });

    const collector = reply.createMessageComponentCollector({
        filter: i => i.user.id === interaction.user.id,
        time: 30000, 
    });

    collector.on('collect', async i => {
        if (i.customId === 'confirm_warn') {
            await i.update({ content: 'Processing...', embeds: [], components: [] }); // Clear confirmation and show loading
            collector.stop('confirmed'); // Stop the collector after confirmation
            await processWarnAction(interaction, targetUser, reason, resetWarnings, guildId, moderatorId, db);
        } else if (i.customId === 'cancel_warn') {
            await i.update({ content: '✅ Action cancelled.', embeds: [], components: [] });
            collector.stop('cancelled'); // Stop the collector after cancellation
        }
    });

    collector.on('end', async (collected, reasonCollected) => {
        if (reasonCollected === 'time') {
            await interaction.editReply({ content: '⏰ Action timed out. Please run the command again if you wish to proceed.', embeds: [], components: [] });
        }
    });
}

/**
 * Encapsulates the core warning/reset logic to be executed after confirmation.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction The original interaction.
 * @param {import('discord.js').GuildMember} targetUser The target member.
 * @param {string} reason The reason for the action.
 * @param {boolean} resetWarnings Whether to reset warnings or issue a new one.
 * @param {string} guildId The ID of the guild.
 * @param {string} moderatorId The ID of the moderator.
 * @param {object} db The database connection object.
 */
async function processWarnAction(interaction, targetUser, reason, resetWarnings, guildId, moderatorId, db) {
    try {
        if (resetWarnings) {
            const deleteResult = await new Promise((resolve, reject) => {
                db.run(`DELETE FROM warnings WHERE userId = ? AND guildId = ?`,
                    [targetUser.id, guildId],
                    function(err) {
                        if (err) return reject(err);
                        resolve(this.changes);
                    }
                );
            });

            if (deleteResult > 0) {
                await new Promise((resolve, reject) => {
                    db.run(`INSERT INTO moderation_actions (action_type, moderator_id, target_user_id, guild_id, timestamp, reason) VALUES (?, ?, ?, ?, ?, ?)`,
                        ['reset_warnings', moderatorId, targetUser.id, guildId, Date.now(), reason],
                        function(err) {
                            if (err) {
                                console.error('Error logging reset_warnings action:', err.message);
                            }
                            resolve();
                        }
                    );
                });

                const embed = new EmbedBuilder()
                    .setColor('#00FF00')
                    .setTitle('✅ Warnings Reset')
                    .setDescription(`All warnings for **${targetUser.user.tag}** have been reset.`)
                    .addFields(
                        { name: 'Moderator', value: interaction.user.tag, inline: true },
                        { name: 'Reason', value: reason, inline: true },
                        { name: 'Warnings Cleared', value: deleteResult.toString(), inline: true }
                    )
                    .setTimestamp();
                
                await interaction.editReply({ embeds: [embed], components: [] });
            } else {
                await interaction.editReply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`⚠️ **${targetUser.user.tag}** had no warnings to reset in this server.`)], components: [] });
            }

        } else {
            const guildConfig = await new Promise((resolve, reject) => {
                db.get(`SELECT rep_deduction_per_warn, rep_lockout_duration_ms FROM guild_configs WHERE guild_id = ?`,
                    [guildId], (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    });
            });

            const repDeduction = guildConfig ? guildConfig.rep_deduction_per_warn : 10;
            const repLockoutDuration = guildConfig ? guildConfig.rep_lockout_duration_ms : 86400000; // Default 24 hours

            await new Promise((resolve, reject) => {
                db.run(`INSERT INTO warnings (userId, guildId, moderatorId, reason, timestamp) VALUES (?, ?, ?, ?, ?)`,
                    [targetUser.id, guildId, moderatorId, reason, Date.now()],
                    function(err) {
                        if (err) return reject(err);
                        resolve(this.lastID);
                    }
                );
            });
            await new Promise((resolve, reject) => {
                db.run(`INSERT INTO reputation (user_id, guild_id, reputation_points) VALUES (?, ?, ?)
                        ON CONFLICT(user_id, guild_id) DO UPDATE SET reputation_points = MAX(0, reputation_points - ?)`, // Ensure reputation doesn't go below 0
                    [targetUser.id, guildId, -repDeduction, repDeduction], // Initial insert for new users, then update
                    function(err) {
                        if (err) return reject(err);
                        resolve();
                    }
                );
            });
            const lockoutUntil = Date.now() + repLockoutDuration;
            await new Promise((resolve, reject) => {
                db.run(`INSERT INTO user_stats (user_id, guild_id, reputation_lockout_until) VALUES (?, ?, ?)
                        ON CONFLICT(user_id, guild_id) DO UPDATE SET reputation_lockout_until = ?`,
                    [targetUser.id, guildId, lockoutUntil, lockoutUntil],
                    function(err) {
                        if (err) return reject(err);
                        resolve();
                    }
                );
            });
            const warnResult = await new Promise((resolve, reject) => {
                db.get(`SELECT COUNT(*) as warn_count FROM warnings WHERE userId = ? AND guildId = ?`,
                    [targetUser.id, guildId], (err, row) => {
                        if (err) return reject(err);
                        resolve(row);
                    }
                );
            });
            const currentWarnCount = warnResult ? warnResult.warn_count : 1;

            let replyMessage = '';
            let embedColor = '#FFA500';
            let dmMessageToUser = '';
            let actionsTaken = [];
            let dmAlreadySent = false;

            // Progressive Punishment Ladder based on warn count
            if (currentWarnCount === 1) {
                // --- WARN 1: 24h Timeout + Server-wide message cleanup + Anonymous DM ---
                embedColor = '#FFA500';

                // 1. Timeout for 24h
                const timeoutDurationMs = 24 * 60 * 60 * 1000;
                if (targetUser.moderatable) {
                    try {
                        await targetUser.timeout(timeoutDurationMs, `Warn 1: 24h timeout - ${reason}`);
                        actionsTaken.push('⏳ Placed in 24-hour timeout');
                    } catch (timeoutErr) {
                        console.error('Failed to timeout user on Warn 1:', timeoutErr);
                        actionsTaken.push(`⚠️ Failed to apply timeout: ${timeoutErr.message}`);
                    }
                } else {
                    actionsTaken.push('⚠️ Could not apply timeout (role hierarchy or missing permissions)');
                }

                // 2. Delete all recent messages from all channels in server (past 24h)
                try {
                    const { totalDeleted, channelsProcessed } = await cleanUserMessagesAcrossGuild(
                        interaction.guild,
                        targetUser.id,
                        timeoutDurationMs,
                        { reason: `Warn 1: Purge recent messages - ${reason}` }
                    );
                    actionsTaken.push(`🧹 Purged ${totalDeleted} message(s) from past 24h across ${channelsProcessed} channel(s)`);
                } catch (cleanErr) {
                    console.error('Failed to clean messages on Warn 1:', cleanErr);
                    actionsTaken.push('⚠️ Error during message purge');
                }

                // 3. Private DM (WITHOUT mentioning any moderator)
                dmMessageToUser = `⚠️ **Warning #1 Received in ${interaction.guild.name}**\n\n` +
                    `**Reason:** \`${reason}\`\n` +
                    `**Punishment:** You have been placed in **timeout for 24 hours**, and your recent messages across all channels have been deleted.\n` +
                    `**Reputation:** Reduced by ${repDeduction} points. Reputation lockout until <t:${Math.floor(lockoutUntil / 1000)}:R>.\n\n` +
                    `*Please respect the server rules. A second warning will result in the Server Ban role (view-only access).*`;

                replyMessage = `**${targetUser.user.tag}** has received **Warning #1**.\n` + actionsTaken.map(a => `• ${a}`).join('\n');

            } else if (currentWarnCount === 2) {
                // --- WARN 2: Server Ban Role + Server-wide message cleanup + Anonymous DM ---
                embedColor = '#FF8C00';

                // 1. Assign Server Ban Role
                try {
                    const roleResult = await assignServerBanRole(targetUser, `Warn 2: Server ban role - ${reason}`);
                    if (roleResult.success) {
                        actionsTaken.push('🔒 Assigned Server Ban role (view-only access)');
                    } else {
                        actionsTaken.push(`⚠️ Could not assign Server Ban role: ${roleResult.error}`);
                    }
                } catch (roleErr) {
                    console.error('Failed to assign server ban role on Warn 2:', roleErr);
                    actionsTaken.push(`⚠️ Error assigning Server Ban role: ${roleErr.message}`);
                }

                // 2. Delete all recent messages from all channels in server (past 24h)
                try {
                    const { totalDeleted, channelsProcessed } = await cleanRecentUserMessagesDeduplicated(
                        interaction.guild,
                        targetUser.id,
                        24 * 60 * 60 * 1000,
                        `Warn 2: Server ban role purge - ${reason}`
                    );
                    actionsTaken.push(`🧹 Purged ${totalDeleted} message(s) from past 24h across ${channelsProcessed} channel(s)`);
                } catch (cleanErr) {
                    console.error('Failed to clean messages on Warn 2:', cleanErr);
                    actionsTaken.push('⚠️ Error during message purge');
                }

                // 3. Private DM (WITHOUT mentioning any moderator)
                dmMessageToUser = `⚠️ **Warning #2 Received in ${interaction.guild.name}**\n\n` +
                    `**Reason:** \`${reason}\`\n` +
                    `**Punishment:** You have been given the **Server Ban role** (restricted view-only access), and your recent messages across all channels have been deleted.\n` +
                    `**Reputation:** Reduced by ${repDeduction} points. Reputation lockout until <t:${Math.floor(lockoutUntil / 1000)}:R>.\n\n` +
                    `*⚠️ Warning: Accumulating further warnings will result in extended timeouts, kicks, or a permanent ban.*`;

                replyMessage = `**${targetUser.user.tag}** has received **Warning #2**.\n` + actionsTaken.map(a => `• ${a}`).join('\n');

            } else if (currentWarnCount === 3) {
                // --- WARN 3: 7-day timeout + Server Ban Role maintained + Anonymous DM ---
                embedColor = '#FF4500';

                // 1. Apply 7-day timeout
                const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
                if (targetUser.moderatable) {
                    try {
                        await targetUser.timeout(sevenDaysMs, `Warn 3: 7-day timeout - ${reason}`);
                        actionsTaken.push('⏳ Applied 7-day timeout');
                    } catch (timeoutErr) {
                        actionsTaken.push(`⚠️ Failed to apply 7-day timeout: ${timeoutErr.message}`);
                    }
                }

                // 2. Maintain Server Ban Role
                await assignServerBanRole(targetUser, `Warn 3: Maintain server ban role - ${reason}`);
                actionsTaken.push('🔒 Maintained Server Ban role');

                // 3. Purge past 24h messages
                try {
                    const { totalDeleted, channelsProcessed } = await cleanRecentUserMessagesDeduplicated(
                        interaction.guild,
                        targetUser.id,
                        24 * 60 * 60 * 1000,
                        `Warn 3 purge - ${reason}`
                    );
                    actionsTaken.push(`🧹 Purged ${totalDeleted} message(s) across ${channelsProcessed} channel(s)`);
                } catch (_) {}

                // 4. Private DM (WITHOUT mentioning any moderator)
                dmMessageToUser = `🚨 **Warning #3 Received in ${interaction.guild.name}**\n\n` +
                    `**Reason:** \`${reason}\`\n` +
                    `**Punishment:** 7-day timeout with restricted server access.\n\n` +
                    `*⚠️ FINAL WARNING: Receiving Warning #4 will result in an immediate KICK from the server.*`;

                replyMessage = `**${targetUser.user.tag}** has received **Warning #3**.\n` + actionsTaken.map(a => `• ${a}`).join('\n');

            } else if (currentWarnCount === 4) {
                // --- WARN 4: Server Kick + Anonymous DM ---
                embedColor = '#DC143C';

                // Send DM before kick (WITHOUT mentioning any moderator)
                dmMessageToUser = `🚨 **Warning #4 - Kicked from ${interaction.guild.name}**\n\n` +
                    `**Reason:** \`${reason}\`\n` +
                    `**Action:** You have been **kicked** from the server for accumulating 4 warnings.\n\n` +
                    `*⚠️ Rejoining and receiving another warning will result in an irrevocable permanent BAN.*`;

                await targetUser.send(dmMessageToUser).catch(() => null);
                dmAlreadySent = true;

                // Kick user
                if (targetUser.kickable) {
                    try {
                        await targetUser.kick(`Exceeded warning threshold (4 warnings). Reason: ${reason}`);
                        actionsTaken.push('🚪 Kicked from the server');
                    } catch (kickErr) {
                        console.error('Failed to kick user on Warn 4:', kickErr);
                        actionsTaken.push(`⚠️ Failed to kick: ${kickErr.message}`);
                    }
                } else {
                    actionsTaken.push('⚠️ Could not kick user (role hierarchy or lack of permission)');
                }

                replyMessage = `**${targetUser.user.tag}** has received **Warning #4** and has been **kicked** from the server.\n` + actionsTaken.map(a => `• ${a}`).join('\n');

            } else {
                // --- WARN 5+: Permanent Server Ban + Anonymous DM ---
                embedColor = '#FF0000';

                // Send DM before ban (WITHOUT mentioning any moderator)
                dmMessageToUser = `⛔ **Warning #${currentWarnCount} - Permanently Banned from ${interaction.guild.name}**\n\n` +
                    `**Reason:** \`${reason}\`\n` +
                    `**Action:** You have been **permanently banned** from the server for exceeding warning limits (${currentWarnCount} warnings).`;

                await targetUser.send(dmMessageToUser).catch(() => null);
                dmAlreadySent = true;

                // Purge messages
                try {
                    await cleanRecentUserMessagesDeduplicated(
                        interaction.guild,
                        targetUser.id,
                        24 * 60 * 60 * 1000,
                        `Warn ${currentWarnCount} permanent ban purge`
                    );
                    actionsTaken.push('🧹 Purged recent messages from past 24h');
                } catch (_) {}

                // Ban user
                if (targetUser.bannable) {
                    try {
                        await targetUser.ban({
                            reason: `Exceeded warning limit (${currentWarnCount} warnings). Last reason: ${reason}`,
                            deleteMessageSeconds: 86400
                        });
                        actionsTaken.push('🔨 Permanently banned from the server');
                    } catch (banErr) {
                        console.error(`Failed to ban ${targetUser.user.tag}:`, banErr);
                        actionsTaken.push(`⚠️ Failed to ban: ${banErr.message}`);
                    }
                } else {
                    actionsTaken.push('⚠️ Could not ban user (role hierarchy or lack of permission)');
                }

                replyMessage = `**${targetUser.user.tag}** has received **Warning #${currentWarnCount}** and has been **permanently banned**.\n` + actionsTaken.map(a => `• ${a}`).join('\n');
            }

            // Log action to moderation_actions
            await new Promise((resolve) => {
                db.run(
                    `INSERT INTO moderation_actions (action_type, moderator_id, target_user_id, guild_id, timestamp, reason) VALUES (?, ?, ?, ?, ?, ?)`,
                    [`warn_${currentWarnCount}`, moderatorId, targetUser.id, guildId, Date.now(), reason],
                    (err) => {
                        if (err) console.error('Error logging warn moderation action:', err.message);
                        resolve();
                    }
                );
            });

            const currentReputationRow = await new Promise((resolve, reject) => {
                db.get(`SELECT reputation_points FROM reputation WHERE user_id = ? AND guild_id = ?`,
                    [targetUser.id, guildId], (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    });
            });
            const currentReputation = currentReputationRow ? currentReputationRow.reputation_points : 0;

            const embed = new EmbedBuilder()
                .setColor(embedColor)
                .setTitle('⚠️ User Moderated')
                .setDescription(replyMessage)
                .addFields(
                    { name: 'Moderator', value: interaction.user.tag, inline: true },
                    { name: 'Reason', value: reason, inline: true },
                    { name: 'Current Warn Count', value: currentWarnCount.toString(), inline: true },
                    { name: 'Current Reputation', value: currentReputation.toLocaleString(), inline: true }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [embed], components: [] });

            // Send DM if not already sent (e.g. for warn 1, 2, 3)
            if (!dmAlreadySent && dmMessageToUser) {
                targetUser.send(dmMessageToUser)
                    .catch(dmErr => {
                        console.warn(`Could not DM message to ${targetUser.user.tag}:`, dmErr.message);
                        interaction.followUp({ content: `⚠️ Could not DM the user. They might have DMs disabled or I lack permissions.`, ephemeral: true }).catch(() => {});
                    });
            }
        }
    } catch (err) {
        console.error('Error during warn command:', err);
        await interaction.editReply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ An error occurred during the process: ${err.message}`)], components: [] });
    }
}