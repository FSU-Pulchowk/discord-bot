// src/services/ads/adScheduler.js
// Singleton presence-rotation scheduler for the Advertisement Engine.
//
// Design guarantees:
//  - Only one interval ever runs (idempotent startAdScheduler).
//  - Never creates per-ad or per-guild timers.
//  - Re-applies correct presence on shard resume.
//  - Restores the static presence on stop or when no eligible ad exists.

import { getEligiblePresenceAds } from './adRepository.js';
import { filterEligibleAds, pickBestPresenceAd } from './adEligibility.js';
import { applyAdPresence, restoreStaticPresence } from './adPresence.js';

const ROTATION_INTERVAL_MS = parseInt(process.env.AD_ROTATION_INTERVAL_MS ?? '300000', 10);

let _interval   = null;
let _client     = null;
let _currentId  = null; // ID of the ad currently controlling presence (or null)

/**
 * Start the scheduler.  Must be called once from the ClientReady handler,
 * after setupBotPresence().  Safe to call multiple times — extra calls are no-ops.
 *
 * @param {import('discord.js').Client} client
 */
export function startAdScheduler(client) {
    if (_interval) {
        console.log('[AdScheduler] Already running — skipping duplicate start');
        return;
    }

    _client = client;

    _tick();
    _interval = setInterval(_tick, ROTATION_INTERVAL_MS);

    client.on('shardResume', () => {
        console.log('[AdScheduler] Shard resumed — rerunning rotation tick');
        _tick();
    });

    console.log(`[AdScheduler] Started (interval: ${ROTATION_INTERVAL_MS / 1000}s)`);
}

/**
 * Stop the scheduler and restore the static presence immediately.
 */
export function stopAdScheduler() {
    if (_interval) {
        clearInterval(_interval);
        _interval = null;
    }
    if (_client) {
        restoreStaticPresence(_client);
        _client   = null;
    }
    _currentId = null;
    console.log('[AdScheduler] Stopped — static presence restored');
}

/**
 * Return the ID of the ad currently controlling presence, or null.
 */
export function getCurrentPresenceAdId() {
    return _currentId;
}

/**
 * Force a re-evaluation immediately (e.g. after an ad is enabled/disabled).
 */
export function forceRotationTick() {
    _tick();
}

async function _tick() {
    if (!_client?.user) return;

    try {
        const now     = Date.now();
        const ads     = await getEligiblePresenceAds(now);
        const eligible = filterEligibleAds(ads, { now });
        const best    = pickBestPresenceAd(eligible);

        if (best) {
            if (best.id !== _currentId) {
                applyAdPresence(_client, best);
                _currentId = best.id;
                console.log(`[AdScheduler] → Ad presence: ${best.id} (${best.title})`);
            }
            // else: same ad, no change needed
        } else {
            if (_currentId !== null) {
                restoreStaticPresence(_client);
                _currentId = null;
                console.log('[AdScheduler] → No eligible ads — static presence restored');
            }
        }
    } catch (err) {
        console.error('[AdScheduler] Error during rotation tick:', err);
    }
}