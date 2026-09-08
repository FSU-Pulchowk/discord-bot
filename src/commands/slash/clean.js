import {
    SlashCommandBuilder,
    PermissionsBitField,
    EmbedBuilder,
    ChannelType,
} from 'discord.js';
import { cleanUserMessagesAcrossGuild, parseDuration } from '../../utils/moderationUtils.js';

export const data = new SlashCommandBuilder()
    .setName('clean')
    .setDescription('Deletes messages within a specific time frame from a channel or all channels.')
    .addStringOption(option =>
        option.setName('duration')
        .setDescription('Duration like 10m, 1h, 2d (up to 14d)')
        .setRequired(true))
    .addIntegerOption(option =>
        option.setName('count')
        .setDescription('Number of messages to delete (up to 100)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(100))
    .addUserOption(option =>
        option.setName('target_user')
        .setDescription('Only delete messages from a specific user (cleans all channels if channel is not specified)')
        .setRequired(false)) 
    .addStringOption(option =>
        option.setName('reason')
        .setDescription('Reason for message deletion')
        .setRequired(false))
    .addChannelOption(option =>
        option.setName('channel')
        .setDescription('Channel to clean (omit to clean all channels when user is specified)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false)) 
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild);

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: '❌ This command can only be used in a server.', ephemeral: true });
    }

    // CRITICAL: Defer reply immediately to avoid interaction timeout (3 second limit)
    let isDeferred = false;
    try {
        await interaction.deferReply({ ephemeral: true });
        isDeferred = true;
    } catch (deferError) {
        if (deferError.code === 10062) {
            console.error('Interaction expired before deferring in clean command');
            return;
        }
        try {
            await interaction.reply({
                content: '⏳ Processing your request...',
                ephemeral: true
            });
            isDeferred = false;
        } catch (replyError) {
            console.error('Failed to respond to interaction in clean command:', replyError);
            return;
        }
    }
    
    const durationInput = interaction.options.getString('duration');
    const count = interaction.options.getInteger('count');
    const targetUser = interaction.options.getUser('target_user');
    const reason = interaction.options.getString('reason') || 'No reason provided.';
    const explicitChannel = interaction.options.getChannel('channel');

    const durationMs = parseDuration(durationInput);
    if (!durationMs || durationMs > 14 * 24 * 60 * 60 * 1000) {
        const errorMsg = '❌ Invalid duration. Use `s`, `m`, `h`, or `d` (up to 14 days). Example: `30m`, `2h`, `2d`';
        return interaction.editReply({ content: errorMsg }).catch(() => {
            interaction.followUp({ content: errorMsg, ephemeral: true }).catch(() => {});
        });
    }

    try {
        // Case 1: target_user is specified AND NO explicit channel is specified -> Purge from ALL channels in the server
        if (targetUser && !explicitChannel) {
            const { totalDeleted, channelsProcessed } = await cleanUserMessagesAcrossGuild(
                interaction.guild,
                targetUser.id,
                durationMs,
                { maxCount: count || Infinity, reason }
            );

            const embed = new EmbedBuilder()
                .setColor('#00ffff')
                .setTitle('🧹 Server-Wide Clean Complete')
                .setDescription(`Successfully purged recent messages for ${targetUser} across all channels.`)
                .addFields(
                    { name: '🕒 Duration', value: durationInput, inline: true },
                    { name: '👤 Targeted User', value: `${targetUser} (${targetUser.tag || targetUser.username})`, inline: true },
                    { name: '📺 Scope', value: `All channels (${channelsProcessed} channels affected)`, inline: true },
                    { name: '🧮 Deleted', value: `${totalDeleted} messages`, inline: true },
                    { name: '📄 Reason', value: reason, inline: false }
                );

            if (count) {
                embed.addFields({ name: '🔢 Messages Limit', value: `${count}`, inline: true });
            }

            embed.setTimestamp();
            return await interaction.editReply({ embeds: [embed] });
        }

        // Case 2: Specific channel specified (with or without target_user), OR no user specified (current channel)
        const targetChannel = explicitChannel || interaction.channel;
        const now = Date.now();
        const threshold = now - durationMs;
        const twoWeeksAgo = now - (14 * 24 * 60 * 60 * 1000);
        const maxCount = count || Infinity;

        // Paginate through the channel's history until we go past the duration threshold.
        // Each round fetches up to 100 messages; we stop when any message is older than
        // the threshold (messages are returned newest-first) or we have enough messages.
        const messagesToDelete = [];
        let lastMessageId = null;
        let keepFetching = true;
        const maxFetchRounds = 10; // up to 1000 messages per channel
        let fetchRounds = 0;

        while (keepFetching && fetchRounds < maxFetchRounds) {
            fetchRounds++;
            const fetchOptions = { limit: 100 };
            if (lastMessageId) fetchOptions.before = lastMessageId;

            const fetched = await targetChannel.messages.fetch(fetchOptions).catch(() => null);
            if (!fetched || fetched.size === 0) break;

            for (const msg of fetched.values()) {
                // Messages are newest-first; once we hit one older than the threshold, stop.
                if (msg.createdTimestamp < threshold) {
                    keepFetching = false;
                    break;
                }
                if (!msg.deletable) continue;
                if (targetUser && msg.author.id !== targetUser.id) continue;

                messagesToDelete.push(msg);
                if (messagesToDelete.length >= maxCount) {
                    keepFetching = false;
                    break;
                }
            }

            lastMessageId = fetched.last()?.id;
            if (fetched.size < 100) break; // no more messages in channel
        }

        let deletedCount = 0;
        const recentMsgs = messagesToDelete.filter(m => m.createdTimestamp > twoWeeksAgo);
        const olderMsgs  = messagesToDelete.filter(m => m.createdTimestamp <= twoWeeksAgo);

        // Bulk-delete messages ≤14 days old (Discord API limit for bulkDelete)
        if (recentMsgs.length > 0) {
            if (recentMsgs.length === 1) {
                try {
                    await recentMsgs[0].delete();
                    deletedCount++;
                } catch (err) {
                    console.error('Failed to delete single message:', err);
                }
            } else {
                // bulkDelete accepts at most 100 at a time
                for (let i = 0; i < recentMsgs.length; i += 100) {
                    const batch = recentMsgs.slice(i, i + 100);
                    try {
                        if (batch.length === 1) {
                            await batch[0].delete();
                            deletedCount++;
                        } else {
                            const deleted = await targetChannel.bulkDelete(batch, true);
                            deletedCount += deleted.size;
                        }
                    } catch (bulkErr) {
                        console.warn('Bulk delete failed, falling back to individual deletes:', bulkErr.message);
                        for (const msg of batch) {
                            try { await msg.delete(); deletedCount++; } catch (_) {}
                        }
                    }
                }
            }
        }

        // Messages older than 14 days must be deleted one-by-one
        if (olderMsgs.length > 0) {
            const oldDeletes = olderMsgs.map(msg =>
                msg.delete().then(() => { deletedCount++; }).catch(() => null)
            );
            await Promise.allSettled(oldDeletes);
        }

        const embed = new EmbedBuilder()
            .setColor('#00ffff')
            .setTitle('🧹 Clean Complete')
            .addFields(
                { name: '🕒 Duration', value: durationInput, inline: true },
                { name: '📄 Reason', value: reason, inline: true },
                { name: '📺 Channel', value: `${targetChannel}`, inline: true },
                { name: '🧮 Deleted', value: `${deletedCount} messages`, inline: true }
            );

        if (targetUser) {
            embed.addFields({ name: '👤 Targeted User', value: `${targetUser}`, inline: true });
        }
        if (count) {
            embed.addFields({ name: '🔢 Messages Limit', value: `${count}`, inline: true });
        }

        embed.setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    } catch (err) {
        console.error('Error during clean:', err);
        try {
            await interaction.editReply({
                content: '❌ Failed to clean messages. Check my permissions.',
            });
        } catch (editErr) {
            if (err.code !== 10062) {
                console.error('Error editing reply:', editErr);
            }
            try {
                await interaction.followUp({
                    content: '❌ Failed to clean messages. Check my permissions.',
                    ephemeral: true
                });
            } catch (followUpErr) {
                console.error('Error sending followUp:', followUpErr);
            }
        }
    }
}