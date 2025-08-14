import { db } from '../database.js';
import { log } from '../utils/debug.js';

/**
 * Adds a new RSS feed subscription to the database.
 * The UNIQUE constraint on the table prevents duplicates.
 * @param {string} guildId The ID of the guild.
 * @param {string} url The URL of the RSS feed.
 * @param {string} channelId The ID of the channel for updates.
 * @param {string | null} lastGuid The GUID of the latest item, or null if not yet set.
 * @param {string | null} title The title of the RSS feed.
 * @returns {Promise<void>}
 */
export function addFeed(guildId, url, channelId, lastGuid, title) {
    return new Promise((resolve, reject) => {
        const sql = `INSERT OR REPLACE INTO rss_feeds (guild_id, channel_id, url, last_guid, title) VALUES (?, ?, ?, ?, ?)`;
        db.run(sql, [guildId, channelId, url, lastGuid, title], (err) => {
            if (err) {
                log("Database error in addFeed:", 'error', null, err, 'error');
                return reject(err);
            }
            resolve();
        });
    });
}

/**
 * Updates the last processed GUID for a specific feed subscription.
 * @param {string} guildId The ID of the guild.
 * @param {string} url The URL of the RSS feed.
 * @param {string} channelId The ID of the channel.
 * @param {string} lastGuid The GUID of the latest item.
 * @returns {Promise<void>}
 */
export function updateLastGuid(guildId, url, channelId, lastGuid) {
    return new Promise((resolve, reject) => {
        const sql = `UPDATE rss_feeds SET last_guid = ? WHERE guild_id = ? AND channel_id = ? AND url = ?`;
        db.run(sql, [lastGuid, guildId, channelId, url], (err) => {
            if (err) {
                // Use the new log function
                log("Database error in updateLastGuid:", 'error', null, err, 'error');
                return reject(err);
            }
            resolve();
        });
    });
}

/**
 * Retrieves all feed subscriptions and groups them by guild.
 * @returns {Promise<Map<string, Array<{url: string, channelId: string, lastGuid: string | null, title: string | null}>>>}
 * A map where keys are guild IDs and values are arrays of feed objects.
 */
export function getAllFeeds() {
    return new Promise((resolve, reject) => {
        const sql = `SELECT guild_id, url, channel_id, last_guid, title FROM rss_feeds`;
        db.all(sql, [], (err, rows) => {
            if (err) {
                log("Database error in getAllFeeds:", 'error', null, err, 'error');
                return reject(err);
            }

            const feedsByGuild = new Map();
            rows.forEach(row => {
                const feed = {
                    url: row.url,
                    channelId: row.channel_id,
                    lastGuid: row.last_guid,
                    title: row.title
                };
                if (!feedsByGuild.has(row.guild_id)) {
                    feedsByGuild.set(row.guild_id, []);
                }
                feedsByGuild.get(row.guild_id).push(feed);
            });
            resolve(feedsByGuild);
        });
    });
}

/**
 * Removes an RSS feed subscription from the database.
 * @param {string} guildId The ID of the guild.
 * @param {string} url The URL of the feed to remove.
 * @returns {Promise<boolean>} True if a feed was removed, false otherwise.
 */
export function removeFeed(guildId, url) {
    return new Promise((resolve, reject) => {
        const sql = `DELETE FROM rss_feeds WHERE guild_id = ? AND url = ?`;
        db.run(sql, [guildId, url], function(err) {
            if (err) {
                log("Database error in removeFeed:", 'error', null, err, 'error');
                return reject(err);
            }
            resolve(this.changes > 0);
        });
    });
}

/**
 * Retrieves all RSS feed subscriptions for a specific guild.
 * @param {string} guildId The ID of the guild.
 * @returns {Promise<Array<{url: string, channelId: string, lastGuid: string | null, title: string | null}>>}
 * An array of feed objects for the given guild.
 */
export function getGuildFeeds(guildId) {
    return new Promise((resolve, reject) => {
        const sql = `SELECT url, channel_id, last_guid, title FROM rss_feeds WHERE guild_id = ?`;
        db.all(sql, [guildId], (err, rows) => {
            if (err) {
                log("Database error in getGuildFeeds:", 'error', null, err, 'error');
                return reject(err);
            }
            const feeds = rows.map(row => ({
                url: row.url,
                channelId: row.channel_id,
                lastGuid: row.last_guid,
                title: row.title
            }));
            resolve(feeds);
        });
    });
}