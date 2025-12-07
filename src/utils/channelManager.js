// src/utils/channelManager.js
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { log } from './debug.js';

/**
 * Get or create a private event channel for a club
 * @param {Object} club - Club database object
 * @param {Guild} guild - Discord guild
 * @returns {Promise<TextChannel>} - The private event channel
 */
export async function getOrCreatePrivateEventChannel(club, guild) {
    try {
        // Check if club already has a private event channel
        if (club.private_event_channel_id) {
            try {
                const existingChannel = await guild.channels.fetch(club.private_event_channel_id);
                if (existingChannel) {
                    log(`Using existing private event channel for club ${club.name}`, 'channel', { channelId: existingChannel.id });
                    return existingChannel;
                }
            } catch (error) {
                log('Existing private event channel not found, creating new one', 'channel', null, error, 'warn');
            }
        }

        // Create new private event channel
        const channelName = `${club.slug}-events`;

        // Find club's category if it exists
        let category = null;
        if (club.category_id) {
            try {
                category = await guild.channels.fetch(club.category_id);
            } catch (error) {
                log('Club category not found', 'channel', { categoryId: club.category_id }, error, 'warn');
            }
        }

        // Create the channel
        const channel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: category?.id || null,
            topic: `Private events for ${club.name}`,
            reason: `Private event channel for club: ${club.name}`
        });

        log(`Created private event channel for club ${club.name}`, 'channel', {
            channelId: channel.id,
            clubId: club.id
        }, null, 'success');

        // Set up permissions
        await setupPrivateChannelPermissions(channel, club.role_id, club.moderator_role_id, guild);

        return channel;

    } catch (error) {
        log('Error creating private event channel', 'channel', { clubId: club.id }, error, 'error');
        throw error;
    }
}

/**
 * Set up permissions for a private event channel
 * @param {TextChannel} channel - The channel to configure
 * @param {string} clubRoleId - Club member role ID
 * @param {string} moderatorRoleId - Club moderator role ID
 * @param {Guild} guild - Discord guild
 */
export async function setupPrivateChannelPermissions(channel, clubRoleId, moderatorRoleId, guild) {
    try {
        const permissionOverwrites = [
            {
                // @everyone - No access
                id: guild.id,
                deny: [PermissionFlagsBits.ViewChannel]
            },
            {
                // Club members - View and participate
                id: clubRoleId,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.AddReactions,
                    PermissionFlagsBits.EmbedLinks,
                    PermissionFlagsBits.AttachFiles
                ]
            }
        ];

        // Add moderator permissions if moderator role exists
        if (moderatorRoleId) {
            permissionOverwrites.push({
                id: moderatorRoleId,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.AddReactions,
                    PermissionFlagsBits.EmbedLinks,
                    PermissionFlagsBits.AttachFiles,
                    PermissionFlagsBits.ManageMessages,
                    PermissionFlagsBits.PinMessages
                ]
            });
        }

        // Bot permissions
        permissionOverwrites.push({
            id: guild.members.me.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ManageMessages,
                PermissionFlagsBits.EmbedLinks,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageChannels
            ]
        });

        await channel.permissionOverwrites.set(permissionOverwrites);

        log(`Set up permissions for private event channel`, 'channel', {
            channelId: channel.id,
            clubRoleId,
            moderatorRoleId
        }, null, 'success');

    } catch (error) {
        log('Error setting up channel permissions', 'channel', { channelId: channel.id }, error, 'error');
        throw error;
    }
}

/**
 * Update club's private event channel ID in database
 * @param {number} clubId - Club ID
 * @param {string} channelId - Channel ID
 * @param {Database} db - Database instance
 */
export async function updateClubPrivateEventChannel(clubId, channelId, db) {
    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE clubs SET private_event_channel_id = ? WHERE id = ?`,
            [channelId, clubId],
            (err) => {
                if (err) {
                    log('Error updating club private event channel', 'database', { clubId, channelId }, err, 'error');
                    reject(err);
                } else {
                    log(`Updated club ${clubId} with private event channel ${channelId}`, 'database', null, null, 'success');
                    resolve();
                }
            }
        );
    });
}

/**
 * Post event to appropriate channel based on visibility
 * @param {Object} event - Event data
 * @param {Object} club - Club data
 * @param {Guild} guild - Discord guild
 * @param {MessageEmbed} eventEmbed - Event embed to post
 * @param {ActionRowBuilder} components - Message components (buttons)
 * @returns {Promise<Message>} - Posted message
 */
export async function postEventToChannel(event, club, guild, eventEmbed, components = null) {
    try {
        // DEBUG: Log the incoming event object
        log(`DEBUG: postEventToChannel called`, 'event', {
            eventId: event.id,
            eventTitle: event.title,
            event_visibility_value: event.event_visibility,
            event_visibility_type: typeof event.event_visibility,
            full_event_keys: Object.keys(event)
        }, 'warn');

        let targetChannel;

        if (event.event_visibility === 'private') {
            // Post to club's private event channel
            targetChannel = await getOrCreatePrivateEventChannel(club, guild);

            // Update database with channel ID if it's new
            if (!club.private_event_channel_id || club.private_event_channel_id !== targetChannel.id) {
                const { db } = await import('../database.js');
                await updateClubPrivateEventChannel(club.id, targetChannel.id, db);
            }

        } else {
            // Post to public events channel for both 'public' and 'pulchowkian' events
            // Both verified members and public can see events in the same channel
            const publicChannelId = process.env.PUBLIC_EVENTS_CHANNEL_ID || '1447074326963552367';
            targetChannel = await guild.channels.fetch(publicChannelId);

            if (!targetChannel) {
                throw new Error(`Public events channel ${publicChannelId} not found`);
            }
        }

        // Log channel routing decision
        log(`Event visibility routing`, 'event', {
            eventId: event.id,
            eventTitle: event.title,
            visibility: event.event_visibility,
            targetChannelId: targetChannel.id,
            targetChannelName: targetChannel.name
        }, 'verbose');

        // Post the event
        const messageOptions = { embeds: [eventEmbed] };
        if (components) {
            messageOptions.components = [components];
        }

        const message = await targetChannel.send(messageOptions);

        log(`Posted ${event.event_visibility} event to channel`, 'event', {
            eventId: event.id,
            channelId: targetChannel.id,
            messageId: message.id,
            visibility: event.event_visibility
        }, 'success');

        return message;

    } catch (error) {
        log('Error posting event to channel', 'event', {
            eventId: event.id,
            visibility: event.event_visibility
        }, error, 'error');
        throw error;
    }
}
