import { ActivityType } from 'discord.js';

export const YOUTUBE_VIDEO_URL = 'https://www.youtube.com/watch?v=1zRm_9FY4K8';
export const STREAMING_ACTIVITY_NAME = 'Watch this video for Verification';

/**
 * Sets the bot's presence to Streaming with YouTube URL.
 *
 * Why Streaming (ActivityType.Streaming = 1):
 * In Discord, Streaming is the ONLY activity type that provides a clickable "Watch"
 * button on the user's profile card that actually redirects to YouTube/Twitch.
 * Non-streaming types (Watching, Playing, etc.) are strictly static text and cannot be clicked.
 *
 * NOTE: The URL must be in full format (https://www.youtube.com/watch?v=...)
 * because Discord strictly validates the domain/path for the Streaming activity.
 *
 * @param {import('discord.js').Client} client
 */
export function applyBotPresence(client) {
    if (!client.user) {
        console.warn('[BotPresence] client.user is null — skipping (not ready yet)');
        return;
    }
    try {
        client.user.setPresence({
            status: 'online',
            activities: [
                {
                    name: STREAMING_ACTIVITY_NAME,
                    type: ActivityType.Streaming,
                    url: YOUTUBE_VIDEO_URL
                }
            ]
        });
        console.log('[BotPresence] Presence set to Streaming:', STREAMING_ACTIVITY_NAME);
    } catch (error) {
        console.error('[BotPresence] Failed to set presence:', error);
    }
}

/**
 * Applies the bot presence on startup and keeps it alive.
 * Call inside ClientReady — client.user must be non-null.
 *
 * @param {import('discord.js').Client} client
 * @returns {Promise<NodeJS.Timeout>}
 */
export async function setupBotPresence(client) {
    applyBotPresence(client);

    // Re-apply after reconnection (shardResume fires after session is restored)
    client.on('shardResume', () => {
        console.log('[BotPresence] Shard resumed – reapplying presence');
        applyBotPresence(client);
    });

    // Refresh every 5 minutes to prevent Discord from expiring the presence
    const interval = setInterval(() => applyBotPresence(client), 5 * 60 * 1000);

    return interval;
}