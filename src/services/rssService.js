import Parser from 'rss-parser';
import { EmbedBuilder, ChannelType } from 'discord.js';
import { getAllFeeds, updateLastGuid, addFeed } from './rssDbManager.js';
import { XMLParser } from 'fast-xml-parser';
import { fetchWithRetry } from './scraper.js';
import he from 'he';
import { log } from '../utils/debug.js';
import { attachImagesToItems } from '../utils/imageExtactorRSS.js';

const parser = new Parser({
    customFields: {
        item: [
            ['media:content', 'mediaContent'],
            ['media:thumbnail', 'mediaThumbnail'],
            ['content:encoded', 'content:encoded'],
            ['itunes:image', 'itunes:image'],
        ]
    }
});
const xmlParser = new XMLParser();

/**
 * Validates if a URL points to a valid RSS or Atom feed.
 * @param {string} url The URL to validate.
 * @returns {Promise<{isValid: boolean, title: string | null}>}
 */
export async function validateRssUrl(url) {
    try {
        const xmlData = await fetchWithRetry(url);
        const parsedXml = xmlParser.parse(xmlData);
        if (parsedXml.rss?.channel?.item) {
            return { isValid: true, title: parsedXml.rss.channel.title || 'Untitled Feed' };
        }
        if (parsedXml.feed?.entry) {
            return { isValid: true, title: parsedXml.feed.title || 'Untitled Feed' };
        }
        return { isValid: false, title: null };
    } catch (error) {
        log(`Error validating ${url}:`, 'error', null, error, 'error');
        return { isValid: false, title: null };
    }
}

/**
 * Helper function to decode common HTML entities in a string for Node.js environment.
 * @param {string} text The text containing HTML entities.
 * @returns {string} The text with common HTML entities decoded.
 */
function decodeHtmlEntities(text) {
    return text ? he.decode(text) : '';
}

/**
 * Sends the latest entry from a given feed to a specified Discord channel.
 * This version uses the .imageUrl property added by attachImagesToItems.
 * @param {object} feed The parsed feed object from rss-parser.
 * @param {object} latestItem The latest item object from the feed.
 * @param {import('discord.js').TextChannel | import('discord.js').NewsChannel} channel The Discord text or announcement channel to send the embed to.
 * @param {string} guildName The name of the Discord guild.
 * @returns {Promise<void>}
 */
async function sendLatestFeedEntry(feed, latestItem, channel, guildName) {
    const title = decodeHtmlEntities(latestItem.title || 'New Post');
    const description = decodeHtmlEntities(latestItem.contentSnippet?.substring(0, 400) || 'No description available.');
    const feedTitle = decodeHtmlEntities(feed.title);

    const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle(title)
        .setURL(latestItem.link)
        .setDescription(description)
        .setFooter({ text: `From ${feedTitle}` })
        .setTimestamp(latestItem.isoDate ? new Date(latestItem.isoDate) : new Date());

    if (latestItem.imageUrl) {
        embed.setImage(latestItem.imageUrl);
    }

    try {
        await channel.send({ embeds: [embed] });
        log(`[RSS] Posted from "${feedTitle}" to #${channel.name} in "${guildName}".`, 'info');
    } catch (error) {
        log(`[RSS] Failed to post from "${feedTitle}":`, 'error', null, error, 'error');
    }
}

/**
 * Checks all stored RSS feeds for new entries and posts them to their respective channels.
 * @param {import('discord.js').Client} client The Discord client.
 * @returns {Promise<void>}
 */
export async function pollFeeds(client) {
    const feedsByGuild = await getAllFeeds();
    for (const [guildId, feeds] of feedsByGuild) {
        for (const feed of feeds) {
            try {
                log(`[RSS] Checking feed: ${feed.url}`, 'info');

                const feedContent = await parser.parseURL(feed.url);
                if (!feedContent.items?.length) {
                    log(`[RSS] Feed ${feed.url} has no items. Skipping.`, 'warn');
                    continue;
                }
                feedContent.items = await attachImagesToItems(feedContent.items, {
                    siteUrl: feedContent.link || feed.url,
                    verifyWithHEAD: true,
                    scrapePageForOG: true
                });
                const latestItem = feedContent.items[0];
                const newGuid = latestItem.guid || latestItem.link || latestItem.title;

                if (newGuid && newGuid !== feed.lastGuid) {
                    const guild = await client.guilds.fetch(guildId).catch(() => null);
                    if (!guild) continue;

                    const channel = await guild.channels.fetch(feed.channelId).catch(() => null);
                    if (channel && (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)) {
                        await sendLatestFeedEntry(feedContent, latestItem, channel, guild.name);
                        await updateLastGuid(guildId, feed.url, feed.channelId, newGuid);
                    }
                }
            } catch (error) {
                log(`[RSS] Error processing feed ${feed.url}:`, 'error', null, error, 'error');
            }
        }
    }
}

/**
 * Adds a new RSS feed subscription and posts the latest article to the specified channel.
 * @param {import('discord.js').Client} client The Discord client.
 * @param {string} guildId The ID of the guild.
 * @param {string} channelId The ID of the channel to post updates to.
 * @param {string} rssUrl The URL of the RSS feed to subscribe to.
 * @returns {Promise<boolean>} True if the feed was added successfully, false otherwise.
 */
export async function addRssFeedAndPostLatest(client, guildId, channelId, rssUrl) {
    try {
        const validation = await validateRssUrl(rssUrl);
        if (!validation.isValid) {
            log(`[RSS Add] URL ${rssUrl} is not a valid RSS feed.`, 'warn');
            return false;
        }

        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) {
            log(`[RSS Add] Could not find guild ${guildId}.`, 'warn');
            return false;
        }

        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel || !(channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)) {
            log(`[RSS Add] Could not find text or announcement channel ${channelId} in guild ${guildId}.`, 'warn');
            return false;
        }

        const feed = await parser.parseURL(rssUrl);
        if (!feed.items?.length) {
            log(`[RSS Add] Feed ${rssUrl} has no items.`, 'warn');
            await addFeed(guildId, rssUrl, channelId, null, validation.title);
            return false;
        }

        feed.items = await attachImagesToItems(feed.items, {
            siteUrl: feed.link || rssUrl,
            verifyWithHEAD: true,
            scrapePageForOG: true
        });

        const latestItem = feed.items[0];
        const newGuid = latestItem.guid || latestItem.link || latestItem.title;
        await sendLatestFeedEntry(feed, latestItem, channel, guild.name);
        await addFeed(guildId, rssUrl, channelId, newGuid, validation.title);

        log(`[RSS Add] Added feed "${validation.title}" and posted first article to #${channel.name} in "${guild.name}".`, 'info');
        return true;
    } catch (error) {
        log(`[RSS Add] Error adding feed ${rssUrl}:`, 'error', null, error, 'error');
        return false;
    }
}
