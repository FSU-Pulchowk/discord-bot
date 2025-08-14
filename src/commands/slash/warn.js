import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

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
    if (!resetWarnings && !interaction.guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription("❌ I do not have sufficient permissions (e.g., 'Ban Members') to perform this action. Please grant me 'Ban Members' permission.")], ephemeral: true });
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
            const currentWarnCount = warnResult ? warnResult.warn_count : 0;
            let replyMessage = '';
            let embedColor = '#FFA500'; 
            let dmMessageToUser = '';

            if (currentWarnCount > 5) {
                try {
                    await targetUser.ban({ reason: `Exceeded 5 warnings. Total warnings: ${currentWarnCount}. Last warn reason: ${reason}` });
                    replyMessage = `**${targetUser.user.tag}** has been warned for the ${currentWarnCount} time and **banned** due to exceeding 5 warnings.`;
                    embedColor = '#FF0000';
                    dmMessageToUser = `You have been **banned** from **${interaction.guild.name}** because you accumulated ${currentWarnCount} warnings. Your last warning reason was: \`${reason}\`.`;

                } catch (banErr) {
                    console.error(`Failed to ban ${targetUser.user.tag}:`, banErr);
                    replyMessage = `**${targetUser.user.tag}** has been warned for the ${currentWarnCount} time. Failed to ban them: ${banErr.message}. Please check bot permissions and role hierarchy.`;
                    embedColor = '#FFC107'; 
                    dmMessageToUser = `You have been warned in **${interaction.guild.name}** for: \`${reason}\`. This is your warning number: \`${currentWarnCount}\`. You were supposed to be banned, but the bot encountered an error. Please contact a server admin.`;
                }
            } else {
                replyMessage = `**${targetUser.user.tag}** has been warned for the ${currentWarnCount} time.`;
                dmMessageToUser = `You have been warned in **${interaction.guild.name}** for: \`${reason}\`. This is your warning number: \`${currentWarnCount}\`.\n\nYour reputation has been reduced by ${repDeduction} points. You will not be able to gain reputation until <t:${Math.floor(lockoutUntil / 1000)}:R>. Repeated warnings may lead to further moderation actions.`;
            }

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

            targetUser.send(dmMessageToUser)
                .catch(dmErr => {
                    console.warn(`Could not DM message to ${targetUser.user.tag}:`, dmErr.message);
                    interaction.followUp({ content: `⚠️ Could not DM the user. They might have DMs disabled or I lack permissions.`, ephemeral: true }).catch(e => console.error("Error sending DM failure message:", e));
                });
        }
    } catch (err) {
        console.error('Error during warn command:', err);
        await interaction.editReply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ An error occurred during the process: ${err.message}`)], components: [] });
    }
}