// src/services/ads/adEligibility.js
// Stateless eligibility rules for the Advertisement Engine.
// No direct DB calls — callers pass in rows fetched by adRepository.

import { getLastDelivery, getUserDailyDeliveryCount } from './adRepository.js';

/** Per-ad DM cooldown: 24 hours */
export const AD_DM_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Maximum unsolicited DMs per user per 24-hour window */
export const GLOBAL_DM_DAILY_LIMIT = 3;

// Priority weight map (higher = wins)
const PRIORITY_WEIGHT = { critical: 4, high: 3, normal: 2, low: 1 };

/**
 * Check whether a single ad is eligible given a delivery context.
 *
 * @param {object} ad      – row from the `ads` table
 * @param {object} context – optional context fields:
 *   { now, guildId, channelId, userId, roleIds }
 * @returns {boolean}
 */
export function isAdEligible(ad, context = {}) {
    if (!ad || !ad.enabled || ad.deleted) return false;

    const now = context.now ?? Date.now();

    if (ad.starts_at && ad.starts_at > now)  return false;
    if (ad.expires_at && ad.expires_at <= now) return false;

    switch (ad.scope) {
        case 'global':
            return true;
        case 'guild': {
            const targetGuild = ad.scope_target_id || ad.guild_id;
            if (context.guildId && targetGuild && targetGuild !== context.guildId) return false;
            return true;
        }
        case 'channel':
            return context.channelId === ad.scope_target_id;
        case 'role':
            return Array.isArray(context.roleIds) && context.roleIds.includes(ad.scope_target_id);
        case 'user':
            return context.userId === ad.scope_target_id;
        default:
            return true;
    }
}

/**
 * Filter an array of ads to only those passing eligibility.
 */
export function filterEligibleAds(ads, context = {}) {
    return ads.filter(ad => isAdEligible(ad, context));
}

/**
 * Pick the single best (highest-priority) ad from an array.
 * Returns null if the array is empty.
 *
 * @param {object[]} ads
 * @returns {object|null}
 */
export function pickBestPresenceAd(ads) {
    if (!ads || ads.length === 0) return null;
    return [...ads].sort(
        (a, b) => (PRIORITY_WEIGHT[b.priority] ?? 0) - (PRIORITY_WEIGHT[a.priority] ?? 0)
    )[0];
}

/**
 * Check whether a specific user can receive a DM for the given ad.
 * Enforces per-ad cooldown and global daily limit.
 *
 * @param {object} ad
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export async function isUserEligibleForDm(ad, userId) {
    const last = await getLastDelivery(ad.id, userId, 'dm');
    if (last && (Date.now() - last.delivered_at) < AD_DM_COOLDOWN_MS) {
        return false;
    }

    const since = Date.now() - 24 * 60 * 60 * 1000;
    const count = await getUserDailyDeliveryCount(userId, since);
    if (count >= GLOBAL_DM_DAILY_LIMIT) return false;

    return true;
}