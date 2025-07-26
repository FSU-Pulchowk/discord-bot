import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } from 'discord.js';
import { promisify } from 'node:util';

const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID || 'YOUR_VERIFIED_ROLE_ID_HERE';

export const data = new SlashCommandBuilder()
    .setName('mystats')
    .setDescription('Displays your message count, voice chat time, warn status, and more.')
    .setDMPermission(false);

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    if (interaction.replied || interaction.deferred) {
        console.warn(`[myStats] Interaction ${interaction.id} already acknowledged. Skipping.`);
        return;
    }

    await interaction.deferReply();

    const userId = interaction.user.id;
    const guildId = interaction.guild.id;
    const db = interaction.client.db;

    const dbGet = promisify(db.get).bind(db);
    const dbAll = promisify(db.all).bind(db);

    const isModerator = interaction.member.permissions.has(
        PermissionsBitField.Flags.KickMembers || PermissionsBitField.Flags.BanMembers
    );

    const hasVerifiedRole = interaction.member.roles.cache.has(VERIFIED_ROLE_ID);

    try {
        const statsRow = await dbGet(
            `SELECT messages_sent, voice_time_minutes FROM user_stats WHERE user_id = ? AND guild_id = ?`,
            [userId, guildId]
        );

        const warnRows = await dbAll(
            `SELECT reason, timestamp FROM warnings WHERE userId = ? AND guildId = ? ORDER BY timestamp DESC LIMIT 3`,
            [userId, guildId]
        );
        const warnCount = warnRows.length;

        const reputationRow = await dbGet(
            `SELECT reputation_points FROM reputation WHERE user_id = ? AND guild_id = ?`,
            [userId, guildId]
        );

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

        const publicEmbed = new EmbedBuilder()
            .setColor(statusColor)
            .setTitle(`📊 ${interaction.user.tag}'s Server Stats`)
            .setDescription('Here are some general statistics about your activity and standing in this server:')
            .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
            .setTimestamp()
            .addFields(
                { name: 'Messages Sent', value: messagesSent.toLocaleString(), inline: true },
                { name: 'Voice Time', value: `${voiceTimeMinutes} minutes`, inline: true },
                { name: 'Reputation', value: reputationPoints.toLocaleString(), inline: true },
                { name: 'Warn Status', value: `${warnCount} warns (${warnStatus})`, inline: true }
            );

        if (warnCount > 0) {
            const warnReasons = warnRows.map((warn, index) =>
                `${index + 1}. ${warn.reason} (<t:${Math.floor(warn.timestamp / 1000)}:d>)`
            ).join('\n');
            publicEmbed.addFields(
                { name: 'Recent Warn Reasons', value: warnReasons }
            );
        }

        await interaction.editReply({ embeds: [publicEmbed] });

        const privateEmbed = new EmbedBuilder()
            .setColor('#0099FF')
            .setTitle(`🔒 ${interaction.user.tag}'s Private Stats`)
            .setDescription('This message contains sensitive or personal information.')
            .setTimestamp();
        console.log(VERIFIED_ROLE_ID);
        console.log(hasVerifiedRole);
        if (hasVerifiedRole) {
            const verifiedUserRow = await dbGet(
                `SELECT real_name, email FROM verified_users WHERE user_id = ? AND guild_id = ?`,
                [userId, guildId]
            );
            const birthdayRow = await dbGet(
                `SELECT month, day, year FROM birthdays WHERE user_id = ? AND guild_id = ?`,
                [userId, guildId]
            );

            if (verifiedUserRow) {
                privateEmbed.addFields(
                    { name: '\u200b', value: '**Verified Information:**', inline: false },
                    { name: 'Full Name', value: verifiedUserRow.real_name, inline: true },
                    { name: 'Email', value: verifiedUserRow.email, inline: true }
                );

                if (birthdayRow) {
                    let dob = `${birthdayRow.month}/${birthdayRow.day}`;
                    if (birthdayRow.year) {
                        dob += `/${birthdayRow.year}`;
                    }
                    privateEmbed.addFields(
                        { name: 'Date of Birth', value: dob, inline: true }
                    );
                }
            }
        }

        if (isModerator) {
            const modActions = await dbAll(
                `SELECT action_type, COUNT(*) as count FROM moderation_actions WHERE moderator_id = ? AND guild_id = ? GROUP BY action_type`,
                [userId, guildId]
            );

            const modStats = { kicks: 0, bans: 0, timeouts: 0, mutes: 0, deafens: 0 };
            for (const action of modActions) {
                switch (action.action_type) {
                    case 'kick': modStats.kicks = action.count; break;
                    case 'ban': modStats.bans = action.count; break;
                    case 'timeout': modStats.timeouts = action.count; break;
                    case 'mute': modStats.mutes = action.count; break;
                    case 'deafen': modStats.deafens = action.count; break;
                }
            }

            privateEmbed.addFields(
                { name: '\u200b', value: '**Moderation Actions Issued:**', inline: false },
                { name: 'Kicks', value: modStats.kicks.toLocaleString(), inline: true },
                { name: 'Bans', value: modStats.bans.toLocaleString(), inline: true },
                { name: 'Timeouts', value: modStats.timeouts.toLocaleString(), inline: true },
                { name: 'Mutes', value: modStats.mutes.toLocaleString(), inline: true },
                { name: 'Deafens', value: modStats.deafens.toLocaleString(), inline: true }
            );
        }

        if (privateEmbed.data.fields && privateEmbed.data.fields.length > 0) {
            try {
                await interaction.user.send({ embeds: [privateEmbed] });
            } catch (dmError) {
                console.error(`Error sending DM to ${interaction.user.tag}:`, dmError);
                await interaction.followUp({
                    content: 'I could not send your private stats to your DMs. Please check your privacy settings to allow DMs from server members.',
                    ephemeral: true
                });
            }
        }

    } catch (err) {
        console.error('Error fetching stats:', err.message);
        const replyMethod = interaction.deferred || interaction.replied ? 'followUp' : 'editReply';
        await interaction[replyMethod]({
            embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ An error occurred while fetching your stats: ${err.message}`)],
            ephemeral: true
        });
    }
}
