import { ChannelType, PermissionsBitField } from 'discord.js';
import { debugConfig } from './debug.js';

export const LIGHT_BAN_ROLE_ID = process.env.LIGHT_BAN_ROLE_ID || '1418234351493185657';

// In-memory cache to prevent duplicate guild-wide cleans for the same user within 30 seconds
const recentGuildCleans = new Map();

/**
 * Parses duration strings like '10m', '1h', '2d' up to 14 days.
 * @param {string} duration 
 * @returns {number|null} Duration in milliseconds or null if invalid
 */
export function parseDuration(duration) {
    if (!duration || typeof duration !== 'string') return null;
    const match = duration.trim().match(/^(\d+)([smhd])$/i);
    if (!match) return null;
    const [_, num, unit] = match;
    const multiplier = {
        s: 1000,
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000
    }[unit.toLowerCase()];
    return parseInt(num, 10) * multiplier;
}

/**
 * Deletes messages for a specific user across all accessible channels in a guild within durationMs.
 * @param {import('discord.js').Guild} guild 
 * @param {string} userId 
 * @param {number} durationMs Time window in milliseconds from now (e.g. 24h)
 * @param {object} [options]
 * @param {number} [options.maxCount] Max total messages to delete across guild
 * @param {string} [options.reason]
 * @returns {Promise<{ totalDeleted: number, channelsProcessed: number }>}
 */
export async function cleanUserMessagesAcrossGuild(guild, userId, durationMs, options = {}) {
    if (!guild || !userId || !durationMs) {
        return { totalDeleted: 0, channelsProcessed: 0 };
    }

    const { maxCount = Infinity, reason = 'Server-wide user message purge' } = options;
    const now = Date.now();
    const threshold = now - durationMs;
    const twoWeeksAgo = now - (14 * 24 * 60 * 60 * 1000);

    const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
    if (!botMember) {
        debugConfig.log('Could not resolve bot member for guild-wide clean', 'moderation', { guildId: guild.id }, null, 'error');
        return { totalDeleted: 0, channelsProcessed: 0 };
    }

    const supportedTypes = new Set([
        ChannelType.GuildText,
        ChannelType.GuildAnnouncement,
        ChannelType.PublicThread,
        ChannelType.PrivateThread,
        ChannelType.AnnouncementThread
    ]);

    // Gather candidate text channels and threads
    const allChannels = typeof guild.channels?.cache?.filter === 'function'
        ? Array.from(guild.channels.cache.values())
        : Array.from(guild.channels?.cache?.values?.() || []);

    const channelsToCheck = allChannels.filter(channel => {
        if (!supportedTypes.has(channel.type)) return false;
        const perms = channel.permissionsFor ? channel.permissionsFor(botMember) : null;
        return perms && perms.has([
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.ManageMessages
        ]);
    });

    let totalDeleted = 0;
    let channelsProcessed = 0;

    for (const channel of channelsToCheck) {
        if (totalDeleted >= maxCount) break;

        try {
            let lastMessageId = null;
            let channelMessagesToDelete = [];
            let keepFetching = true;
            let fetchRounds = 0;
            const maxFetchRounds = 5; // Fetch up to 500 messages per channel

            while (keepFetching && fetchRounds < maxFetchRounds) {
                fetchRounds++;
                const fetchOptions = { limit: 100 };
                if (lastMessageId) fetchOptions.before = lastMessageId;

                const fetched = await channel.messages.fetch(fetchOptions).catch(() => null);
                if (!fetched || fetched.size === 0) break;

                for (const msg of fetched.values()) {
                    if (msg.createdTimestamp < threshold) {
                        keepFetching = false;
                        break;
                    }
                    if (msg.author.id === userId && msg.deletable) {
                        channelMessagesToDelete.push(msg);
                        if (totalDeleted + channelMessagesToDelete.length >= maxCount) {
                            keepFetching = false;
                            break;
                        }
                    }
                }

                lastMessageId = fetched.last()?.id;
                if (fetched.size < 100) break;
            }

            if (channelMessagesToDelete.length === 0) continue;

            channelsProcessed++;

            // Split into <=14 days (bulk deletable) and >14 days (manual delete)
            const recentMsgs = channelMessagesToDelete.filter(m => m.createdTimestamp > twoWeeksAgo);
            const olderMsgs = channelMessagesToDelete.filter(m => m.createdTimestamp <= twoWeeksAgo);

            // Bulk delete recent messages
            if (recentMsgs.length > 0) {
                if (recentMsgs.length === 1) {
                    try {
                        await recentMsgs[0].delete();
                        totalDeleted++;
                    } catch (err) {
                        debugConfig.log(`Failed single message delete in ${channel.name}`, 'moderation', null, err, 'warn');
                    }
                } else {
                    for (let i = 0; i < recentMsgs.length; i += 100) {
                        const batch = recentMsgs.slice(i, i + 100);
                        try {
                            if (batch.length === 1) {
                                await batch[0].delete();
                                totalDeleted += 1;
                            } else {
                                const deleted = await channel.bulkDelete(batch, true);
                                totalDeleted += deleted.size;
                            }
                        } catch (bulkErr) {
                            debugConfig.log(`Bulk delete fallback in ${channel.name}`, 'moderation', null, bulkErr, 'warn');
                            for (const m of batch) {
                                try {
                                    await m.delete();
                                    totalDeleted++;
                                } catch (_) {}
                            }
                        }
                    }
                }
            }

            // Older messages must be deleted individually
            if (olderMsgs.length > 0) {
                const individualDeletes = olderMsgs.map(m =>
                    m.delete().then(() => { totalDeleted++; }).catch(() => null)
                );
                await Promise.allSettled(individualDeletes);
            }

            // Small delay to be polite to Discord API rate limits
            await new Promise(res => setTimeout(res, 50));
        } catch (channelErr) {
            debugConfig.log(`Error processing channel ${channel.name} during clean`, 'moderation', { channelId: channel.id }, channelErr, 'warn');
        }
    }

    debugConfig.log(`Guild-wide clean for ${userId} finished: deleted ${totalDeleted} messages across ${channelsProcessed} channels`, 'moderation', {
        userId,
        guildId: guild.id,
        totalDeleted,
        channelsProcessed
    });

    return { totalDeleted, channelsProcessed };
}

/**
 * Assigns the server ban role (view-only / restricted access) to a member.
 * @param {import('discord.js').GuildMember} member 
 * @param {string} [reason] 
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function assignServerBanRole(member, reason = 'Server ban role assigned') {
    if (!member || !member.guild) {
        return { success: false, error: 'Invalid member or guild' };
    }

    const guild = member.guild;
    const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);

    if (!botMember || !botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        return { success: false, error: 'Bot lacks Manage Roles permission' };
    }

    const banRole = guild.roles.cache.get(LIGHT_BAN_ROLE_ID);
    if (!banRole) {
        debugConfig.log(`Server ban role ${LIGHT_BAN_ROLE_ID} not found in guild`, 'moderation', { roleId: LIGHT_BAN_ROLE_ID }, null, 'warn');
        return { success: false, error: 'Server ban role not found' };
    }

    if (banRole.position >= botMember.roles.highest.position) {
        debugConfig.log('Server ban role is higher than bot role hierarchy', 'moderation', { roleId: LIGHT_BAN_ROLE_ID }, null, 'warn');
        return { success: false, error: 'Server ban role is above bot role hierarchy' };
    }

    try {
        if (!member.roles.cache.has(LIGHT_BAN_ROLE_ID)) {
            await member.roles.add(banRole, reason);
            debugConfig.log(`Assigned server ban role to ${member.user?.tag || member.id}`, 'moderation', { userId: member.id, roleId: LIGHT_BAN_ROLE_ID }, null, 'success');
        }
        return { success: true, role: banRole };
    } catch (err) {
        debugConfig.log('Error adding server ban role', 'moderation', { userId: member.id }, err, 'error');
        return { success: false, error: err.message };
    }
}

/**
 * Deduplicated server-wide clean for recent user messages (past 24 hours by default).
 * Avoids duplicate executions if triggered by both command/role assignment and GuildMemberUpdate.
 * @param {import('discord.js').Guild} guild 
 * @param {string} userId 
 * @param {number} [durationMs] 
 * @param {string} [reason]
 * @returns {Promise<{ totalDeleted: number, channelsProcessed: number, skipped: boolean }>}
 */
export async function cleanRecentUserMessagesDeduplicated(guild, userId, durationMs = 24 * 60 * 60 * 1000, reason = 'Server ban role message cleanup') {
    const key = `${guild.id}:${userId}`;
    const now = Date.now();
    const lastRun = recentGuildCleans.get(key);

    if (lastRun && (now - lastRun < 30000)) {
        // Clean already triggered within last 30s
        return { totalDeleted: 0, channelsProcessed: 0, skipped: true };
    }

    recentGuildCleans.set(key, now);
    // Cleanup old keys after 60s
    setTimeout(() => {
        if (recentGuildCleans.get(key) === now) {
            recentGuildCleans.delete(key);
        }
    }, 60000);

    const result = await cleanUserMessagesAcrossGuild(guild, userId, durationMs, { reason });
    return { ...result, skipped: false };
}
