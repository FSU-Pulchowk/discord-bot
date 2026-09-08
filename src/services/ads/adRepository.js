// src/services/ads/adRepository.js
// Pure database access layer for the Advertisement Engine.
// All SQL for the `ads` and `ad_deliveries` tables lives here.

import { db } from '../../database.js';

// ---------- helpers ----------

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row || null);
        });
    });
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

/**
 * Insert a new advertisement.
 * @param {object} data – must include `id`, `title`, `description`, `created_by`
 * @returns {Promise<object>} The newly created row
 */
export async function createAd(data) {
    const now = Date.now();
    await run(
        `INSERT INTO ads
         (id, guild_id, title, description, redirect_url, image_url, enabled, priority,
          type, scope, scope_target_id, created_by, created_at, updated_at,
          starts_at, expires_at, deleted, metadata)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)`,
        [
            data.id,
            data.guild_id     ?? null,
            data.title,
            data.description,
            data.redirect_url ?? null,
            data.image_url    ?? null,
            data.enabled      ?? 1,
            data.priority     ?? 'normal',
            data.type         ?? 'presence',
            data.scope        ?? 'guild',
            data.scope_target_id ?? null,
            data.created_by,
            data.created_at   ?? now,
            data.updated_at   ?? now,
            data.starts_at    ?? null,
            data.expires_at   ?? null,
            data.metadata ? JSON.stringify(data.metadata) : null,
        ]
    );
    return get('SELECT * FROM ads WHERE id = ?', [data.id]);
}

/**
 * Fetch a single non-deleted ad by ID.
 */
export async function getAdById(id) {
    return get('SELECT * FROM ads WHERE id = ? AND deleted = 0', [id]);
}

/**
 * List ads for a guild, paginated.
 */
export async function listAds(guildId, { page = 1, limit = 10 } = {}) {
    const offset = (page - 1) * limit;
    const rows = await all(
        `SELECT * FROM ads
         WHERE deleted = 0
           AND (guild_id = ? OR guild_id IS NULL)
         ORDER BY
           CASE priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3
                         WHEN 'normal'   THEN 2 WHEN 'low'  THEN 1 ELSE 0 END DESC,
           created_at DESC
         LIMIT ? OFFSET ?`,
        [guildId, limit, offset]
    );
    const countRow = await get(
        `SELECT COUNT(*) AS total FROM ads WHERE deleted = 0 AND (guild_id = ? OR guild_id IS NULL)`,
        [guildId]
    );
    return { rows, total: countRow?.total ?? 0, page, limit };
}

/**
 * Partial update — only whitelisted fields are touched.
 */
export async function updateAd(id, fields) {
    const allowed = [
        'title', 'description', 'redirect_url', 'image_url', 'enabled',
        'priority', 'type', 'scope', 'scope_target_id', 'starts_at', 'expires_at', 'metadata',
    ];
    const sets = [];
    const vals = [];

    for (const [k, v] of Object.entries(fields)) {
        if (!allowed.includes(k)) continue;
        sets.push(`${k} = ?`);
        vals.push(k === 'metadata' && typeof v === 'object' && v !== null ? JSON.stringify(v) : v);
    }
    if (sets.length === 0) return getAdById(id);

    sets.push('updated_at = ?');
    vals.push(Date.now(), id);
    await run(`UPDATE ads SET ${sets.join(', ')} WHERE id = ?`, vals);
    return getAdById(id);
}

/**
 * Soft-delete an advertisement (sets deleted = 1).
 */
export async function softDeleteAd(id) {
    return run('UPDATE ads SET deleted = 1, updated_at = ? WHERE id = ?', [Date.now(), id]);
}

/**
 * Load all enabled, non-expired, non-deleted presence-type ads.
 * Sorted by priority descending so callers can just take the first one.
 */
export async function getEligiblePresenceAds(now) {
    return all(
        `SELECT * FROM ads
         WHERE deleted = 0 AND enabled = 1 AND type = 'presence'
           AND (starts_at IS NULL OR starts_at <= ?)
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY
           CASE priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3
                         WHEN 'normal'   THEN 2 WHEN 'low'  THEN 1 ELSE 0 END DESC`,
        [now, now]
    );
}

/**
 * Load all enabled, non-expired ads suitable for DM/interaction delivery.
 */
export async function getEligibleDmAds(now) {
    return all(
        `SELECT * FROM ads
         WHERE deleted = 0 AND enabled = 1
           AND type IN ('presence', 'interaction')
           AND (starts_at IS NULL OR starts_at <= ?)
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY
           CASE priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3
                         WHEN 'normal'   THEN 2 WHEN 'low'  THEN 1 ELSE 0 END DESC`,
        [now, now]
    );
}


/**
 * Record that an ad was delivered to a user.
 */
export async function recordDelivery(data) {
    return run(
        `INSERT INTO ad_deliveries
         (advertisement_id, user_id, guild_id, delivery_type, delivered_at)
         VALUES (?,?,?,?,?)`,
        [
            data.advertisement_id,
            data.user_id,
            data.guild_id    ?? null,
            data.delivery_type,
            data.delivered_at ?? Date.now(),
        ]
    );
}

/**
 * Get the most recent delivery of a given ad+type to a user.
 */
export async function getLastDelivery(adId, userId, deliveryType) {
    return get(
        `SELECT * FROM ad_deliveries
         WHERE advertisement_id = ? AND user_id = ? AND delivery_type = ?
         ORDER BY delivered_at DESC LIMIT 1`,
        [adId, userId, deliveryType]
    );
}

/**
 * Count DM deliveries to a user since the given timestamp.
 */
export async function getUserDailyDeliveryCount(userId, since) {
    const row = await get(
        `SELECT COUNT(*) AS cnt FROM ad_deliveries
         WHERE user_id = ? AND delivery_type = 'dm' AND delivered_at >= ?`,
        [userId, since]
    );
    return row?.cnt ?? 0;
}

/**
 * Delivery breakdown by type for a given ad.
 */
export async function getAdStats(adId) {
    return all(
        `SELECT delivery_type, COUNT(*) AS cnt FROM ad_deliveries
         WHERE advertisement_id = ? GROUP BY delivery_type`,
        [adId]
    );
}

/** Mark a delivery as clicked (first click only). */
export async function recordClick(adId, userId) {
    return run(
        `UPDATE ad_deliveries SET clicked_at = ?
         WHERE advertisement_id = ? AND user_id = ? AND clicked_at IS NULL`,
        [Date.now(), adId, userId]
    );
}

/** Mark a delivery as dismissed (first dismiss only). */
export async function recordDismiss(adId, userId) {
    return run(
        `UPDATE ad_deliveries SET dismissed_at = ?
         WHERE advertisement_id = ? AND user_id = ? AND dismissed_at IS NULL`,
        [Date.now(), adId, userId]
    );
}