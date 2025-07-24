import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } from 'discord.js';

const COOLDOWN_DURATION_MS = 24 * 60 * 60 * 1000; 
const COMMAND_NAME_FOR_COOLDOWN = 'repu';

export const data = new SlashCommandBuilder()
    .setName('repu')
    .setDescription('Give 1 reputation point to a user (moderators/admins only, 24h cooldown).')
    .addUserOption(option =>
        option.setName('target_user')
            .setDescription('The user to give reputation to')
            .setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.KickMembers); 
export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }
    const hasModPermissions = interaction.member.permissions.has(PermissionsBitField.Flags.KickMembers) ||
                              interaction.member.permissions.has(PermissionsBitField.Flags.BanMembers) ||
                              interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
    if (!hasModPermissions) {
        return interaction.reply({ content: '❌ You do not have permission to use this command. Only moderators and administrators can use `/repu`.', ephemeral: true });
    }
    const targetUser = interaction.options.getUser('target_user');
    const giverId = interaction.user.id;
    const guildId = interaction.guild.id;
    const db = interaction.client.db;

    if (targetUser.id === giverId) {
        return interaction.reply({ content: '❌ You cannot give reputation to yourself!', ephemeral: true });
    }
    if (targetUser.bot) {
        return interaction.reply({ content: '❌ You cannot give reputation to a bot!', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true }); 

    try {
        const now = Date.now();
        const cooldownRow = await new Promise((resolve, reject) => {
            db.get(`SELECT last_used_at FROM mod_cooldowns WHERE command_name = ? AND user_id = ?`,
                [COMMAND_NAME_FOR_COOLDOWN, giverId], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
        });

        if (cooldownRow && (now - cooldownRow.last_used_at < COOLDOWN_DURATION_MS)) {
            const timeLeft = COOLDOWN_DURATION_MS - (now - cooldownRow.last_used_at);
            const hours = Math.floor(timeLeft / (1000 * 60 * 60));
            const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
            return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`⏳ You can only use the \`/repu\` command once every 24 hours. Please wait ${hours}h ${minutes}m.`)] });
        }

        let lockoutMessage = '';
        const userStatsRow = await new Promise((resolve, reject) => {
            db.get(`SELECT reputation_lockout_until FROM user_stats WHERE user_id = ? AND guild_id = ?`,
                [targetUser.id, guildId], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
        });

        const lockoutUntil = userStatsRow ? userStatsRow.reputation_lockout_until : 0;
        if (lockoutUntil > now) {
            lockoutMessage = `\n*(Note: ${targetUser.tag} is currently in a reputation lockout until <t:${Math.floor(lockoutUntil / 1000)}:R>)*`;
        }
        const guildConfig = await new Promise((resolve, reject) => {
            db.get(`SELECT rep_to_clear_warn FROM guild_configs WHERE guild_id = ?`,
                [guildId], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
        });
        const repToClearWarn = guildConfig ? guildConfig.rep_to_clear_warn : 20;
        await new Promise((resolve, reject) => {
            db.run(`INSERT INTO reputation (user_id, guild_id, reputation_points) VALUES (?, ?, 1)
                    ON CONFLICT(user_id, guild_id) DO UPDATE SET reputation_points = reputation_points + 1`,
                [targetUser.id, guildId],
                function(err) {
                    if (err) return reject(err);
                    resolve();
                }
            );
        });
        await new Promise((resolve, reject) => {
            db.run(`INSERT INTO mod_cooldowns (command_name, user_id, last_used_at) VALUES (?, ?, ?)
                    ON CONFLICT(command_name, user_id) DO UPDATE SET last_used_at = ?`,
                [COMMAND_NAME_FOR_COOLDOWN, giverId, now, now],
                function(err) {
                    if (err) return reject(err);
                    resolve();
                }
            );
        });
        const [updatedReputationRow, oldestWarnRow] = await Promise.all([
            new Promise((resolve, reject) => {
                db.get(`SELECT reputation_points FROM reputation WHERE user_id = ? AND guild_id = ?`,
                    [targetUser.id, guildId], (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    });
            }),
            new Promise((resolve, reject) => {
                db.get(`SELECT id FROM warnings WHERE userId = ? AND guildId = ? ORDER BY timestamp ASC LIMIT 1`,
                    [targetUser.id, guildId], (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    });
            })
        ]);
        const currentRep = updatedReputationRow ? updatedReputationRow.reputation_points : 1;
        let warnClearedMessage = '';
        if (currentRep > 0 && currentRep % repToClearWarn === 0 && oldestWarnRow) {
            await new Promise((resolve, reject) => {
                db.run(`DELETE FROM warnings WHERE id = ?`,
                    [oldestWarnRow.id],
                    function(err) {
                        if (err) return reject(err);
                        resolve();
                    }
                );
            });
            warnClearedMessage = `\n🎉 **${targetUser.tag}'s** oldest warning has been cleared!`;
        }
        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✨ Reputation Added!')
            .setDescription(`**${interaction.user.tag}** has given 1 reputation point to **${targetUser.tag}**!${warnClearedMessage}${lockoutMessage}`)
            .addFields(
                { name: 'Target User', value: targetUser.tag, inline: true },
                { name: 'Current Reputation', value: currentRep.toLocaleString(), inline: true }
            )
            .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });

    } catch (err) {
        console.error('Error in /repu command:', err.message);
        await interaction.editReply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ An unexpected error occurred: ${err.message}`)] });
    }
}