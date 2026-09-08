// src/services/ads/adPresence.js
// Thin wrapper around discord.js presence API for the Advertisement Engine.
// Keeps the static presence definition in one canonical place (presence.js)
// and adds ad-presence switching on top.

import { ActivityType } from 'discord.js';
import { applyBotPresence } from '../../utils/presence.js';

/**
 * Restore the static/default bot presence (Streaming "Watch this video for Verification").
 * Safe to call at any time; no-ops if client isn't ready.
 *
 * @param {import('discord.js').Client} client
 */
export function restoreStaticPresence(client) {
    if (!client?.user) return;
    try {
        applyBotPresence(client);
        console.log('[AdPresence] Static presence restored');
    } catch (err) {
        console.error('[AdPresence] Failed to restore static presence:', err);
    }
}

/**
 * Apply a temporary ad presence.
 *
 * Rules:
 *  - YouTube/Twitch URLs → Streaming activity (gives a clickable "Watch" button)
 *  - Other valid URLs   → Watching activity (no clickable button, but still shows URL in embed)
 *  - No URL             → Watching activity with ad title
 *
 * @param {import('discord.js').Client} client
 * @param {object} ad – row from `ads` table
 */
export function applyAdPresence(client, ad) {
    if (!client?.user) return;
    try {
        const url      = ad.redirect_url;
        const hasUrl   = url && isValidUrl(url);
        const isStream = hasUrl && (url.includes('youtube.com') || url.includes('twitch.tv'));

        client.user.setPresence({
            status: 'online',
            activities: [
                isStream
                    ? { name: ad.title, type: ActivityType.Streaming, url }
                    : { name: ad.title, type: ActivityType.Watching },
            ],
        });
        console.log(`[AdPresence] Applied ad: ${ad.id} — "${ad.title}"`);
    } catch (err) {
        console.error('[AdPresence] Failed to apply ad presence:', err);
    }
}

function isValidUrl(str) {
    try { new URL(str); return true; } catch { return false; }
}