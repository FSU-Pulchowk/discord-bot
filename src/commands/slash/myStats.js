import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } from 'discord.js';

const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID || 'YOUR_VERIFIED_ROLE_ID_HERE';

export const data = new SlashCommandBuilder()
    .setName('mystats')
    .setDescription('Displays your message count, voice chat time, warn status, and more.')
    .setDMPermission(false);

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    const userId = interaction.user.id;
    const guildId = interaction.guild.id;
    const db = interaction.client.db;
    const isModerator = interaction.member.permissions.has(PermissionsBitField.Flags.KickMembers || PermissionsBitField.Flags.BanMembers);
    const hasVerifiedRole = interaction.member.roles.cache.has(VERIFIED_ROLE_ID);

    await interaction.deferReply();

    try {
        const statsRow = await new Promise((resolve, reject) => {
            db.get(`SELECT messages_sent, voice_time_minutes FROM user_stats WHERE user_id = ? AND guild_id = ?`,
                [userId, guildId], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
        });

        const warnRows = await new Promise((resolve, reject) => {
            db.all(`SELECT reason, timestamp FROM warnings WHERE userId = ? AND guildId = ? ORDER BY timestamp DESC LIMIT 3`,
                [userId, guildId], (err, rows) => { // Fetch last 3 warn reasons
                    if (err) reject(err);
                    else resolve(rows);
                });
        });
        const warnCount = warnRows.length;

        const reputationRow = await new Promise((resolve, reject) => {
            db.get(`SELECT reputation_points FROM reputation WHERE user_id = ? AND guild_id = ?`,
                [userId, guildId], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
        });

        let verifiedUserRow = null;
        let birthdayRow = null;
        if (hasVerifiedRole) {
            verifiedUserRow = await new Promise((resolve, reject) => {
                db.get(`SELECT real_name, email FROM verified_users WHERE user_id = ? AND guild_id = ?`,
                    [userId, guildId], (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    });
            });

            birthdayRow = await new Promise((resolve, reject) => {
                db.get(`SELECT month, day, year FROM birthdays WHERE user_id = ? AND guild_id = ?`,
                    [userId, guildId], (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    });
            });
        }


        const messagesSent = statsRow ? statsRow.messages_sent : 0;
        const voiceTimeMinutes = statsRow ? statsRow.voice_time_minutes : 0;
        const reputationPoints = reputationRow ? reputationRow.reputation_points : 0;

        let warnStatus = 'Good';
        let statusColor = '#00FF00';

        if (warnCount >= 1 && warnCount <= 2) {
            warnStatus = 'Minor Risk';
            statusColor = '#FFA500';
        } else if (warnCount >= 3 && warnCount <= 4) {
            warnStatus = 'High Risk';
            statusColor = '#FF4500';
        } else if (warnCount >= 5) {
            warnStatus = 'Critical Risk';
            statusColor = '#FF0000';
        }

        const embed = new EmbedBuilder()
            .setColor(statusColor)
            .setTitle(`📊 ${interaction.user.tag}'s Stats`)
            .setDescription('Your activity and standing in this server:')
            .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
            .setTimestamp()
            .addFields(
                { name: 'Messages Sent', value: messagesSent.toLocaleString(), inline: true },
                { name: 'Voice Time', value: `${voiceTimeMinutes} minutes`, inline: true },
                { name: 'Reputation', value: reputationPoints.toLocaleString(), inline: true },
                { name: 'Warn Status', value: `${warnStatus} (${warnCount} warns)`, inline: true }
            );

        if (warnCount > 0) {
            const warnReasons = warnRows.map((warn, index) =>
                `${index + 1}. ${warn.reason} (<t:${Math.floor(warn.timestamp / 1000)}:d>)`
            ).join('\n');
            embed.addFields(
                { name: 'Recent Warn Reasons', value: warnReasons }
            );
        }

        if (hasVerifiedRole && verifiedUserRow) {
            embed.addFields(
                { name: '\u200b', value: '**Verified Information:**', inline: false }, // Spacer
                { name: 'Full Name', value: verifiedUserRow.real_name, inline: true },
                { name: 'Email', value: verifiedUserRow.email, inline: true }
            );

            if (birthdayRow) {
                let dob = `${birthdayRow.month}/${birthdayRow.day}`;
                if (birthdayRow.year) {
                    dob += `/${birthdayRow.year}`;
                }
                embed.addFields(
                    { name: 'Date of Birth', value: dob, inline: true }
                );
            }
        }


        if (isModerator) {
            const modActions = await new Promise((resolve, reject) => {
                db.all(`SELECT action_type, COUNT(*) as count FROM moderation_actions WHERE moderator_id = ? AND guild_id = ? GROUP BY action_type`,
                    [userId, guildId], (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows);
                    });
            });

            const modStats = {
                kicks: 0,
                bans: 0,
                timeouts: 0,
                mutes: 0,
                deafens: 0,
            };

            for (const action of modActions) {
                switch (action.action_type) {
                    case 'kick': modStats.kicks = action.count; break;
                    case 'ban': modStats.bans = action.count; break;
                    case 'timeout': modStats.timeouts = action.count; break;
                    case 'mute': modStats.mutes = action.count; break;
                    case 'deafen': modStats.deafens = action.count; break;
                }
            }

            embed.addFields(
                { name: '\u200b', value: '**Moderation Actions Issued:**', inline: false }, // Spacer
                { name: 'Kicks', value: modStats.kicks.toLocaleString(), inline: true },
                { name: 'Bans', value: modStats.bans.toLocaleString(), inline: true },
                { name: 'Timeouts', value: modStats.timeouts.toLocaleString(), inline: true },
                { name: 'Mutes', value: modStats.mutes.toLocaleString(), inline: true },
                { name: 'Deafens', value: modStats.deafens.toLocaleString(), inline: true }
            );
        }

        await interaction.editReply({ embeds: [embed] });

    } catch (err) {
        console.error('Error fetching stats:', err.message);
        await interaction.editReply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ An error occurred while fetching your stats: ${err.message}`)], ephemeral: true });
    }
}