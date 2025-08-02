import Parser from 'rss-parser';
import { EmbedBuilder, ChannelType, DiscordAPIError } from 'discord.js';
import { getAllFeeds, updateLastGuid, addFeed } from './rssDbManager.js'; 
import { XMLParser } from 'fast-xml-parser';
import { fetchWithRetry } from './scraper.js';
import he from 'he';

const parser = new Parser({
    customFields: {
        item: [
            ['media:content', 'mediaContent'],
            ['media:thumbnail', 'mediaThumbnail'] 
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
        if (parsedXml.rss && parsedXml.rss.channel && parsedXml.rss.channel.item) {
            return {
                isValid: true,
                title: parsedXml.rss.channel.title || 'Untitled Feed'
            };
        }
        if (parsedXml.feed && parsedXml.feed.feed.entry) { 
            return {
                isValid: true,
                title: parsedXml.feed.title || 'Untitled Feed'
            };
        }
        return { isValid: false, title: null };
    } catch (error) {
        console.error(`[RSS Validator] Error validating ${url}:`, error.message);
        return { isValid: false, title: null };
    }
}

/**
 * Helper function to extract the first image URL from an HTML string.
 * @param {string} htmlString The HTML content to parse.
 * @returns {string | null} The URL of the first image found, or null if none.
 */
function extractImageUrlFromHtml(htmlString) {
    if (!htmlString) return null;
    const imgMatch = htmlString.match(/<img[^>]+src="([^">]+)"/);
    return imgMatch ? imgMatch[1] : null;
}

/**
 * Helper function to decode common HTML entities in a string for Node.js environment.
 * @param {string} text The text containing HTML entities.
 * @returns {string} The text with common HTML entities decoded.
 */
function decodeHtmlEntities(text) {
    if (!text) return '';
    return he.decode(text);
}

/**
 * Sends the latest entry from a given feed to a specified Discord channel.
 * @param {object} feed The parsed feed object from rss-parser.
 * @param {object} latestItem The latest item object from the feed.
 * @param {import('discord.js').TextChannel | import('discord.js').NewsChannel} channel The Discord text or announcement channel to send the embed to.
 * @param {string} guildName The name of the Discord guild.
 * @returns {Promise<void>}
 */
async function sendLatestFeedEntry(feed, latestItem, channel, guildName) {
    let title = decodeHtmlEntities(latestItem.title || 'New Post');
    let description = decodeHtmlEntities(latestItem.contentSnippet ? latestItem.contentSnippet.substring(0, 400) : 'No description available.');
    let feedTitle = decodeHtmlEntities(feed.title);

    const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle(title)
        .setURL(latestItem.link)
        .setDescription(description)
        .setFooter({ text: `From ${feedTitle}` })
        .setTimestamp(latestItem.isoDate ? new Date(latestItem.isoDate) : new Date());

    let imageUrl = null;
    if (latestItem.mediaContent && latestItem.mediaContent.$ && latestItem.mediaContent.$.url) {
        imageUrl = latestItem.mediaContent.$.url;
    } else if (latestItem.mediaThumbnail && latestItem.mediaThumbnail.$ && latestItem.mediaThumbnail.$.url) {
        imageUrl = latestItem.mediaThumbnail.$.url;
    }
    else if (latestItem.media) {
        if (Array.isArray(latestItem.media.content) && latestItem.media.content.length > 0 && latestItem.media.content[0].url) {
            imageUrl = latestItem.media.content[0].url;
        } else if (typeof latestItem.media.content === 'object' && latestItem.media.content.url) {
            imageUrl = latestItem.media.content.url;
        } else if (Array.isArray(latestItem.media.thumbnail) && latestItem.media.thumbnail.length > 0 && latestItem.media.thumbnail[0].url) {
            imageUrl = latestItem.media.thumbnail[0].url;
        } else if (typeof latestItem.media.thumbnail === 'object' && latestItem.media.thumbnail.url) {
            imageUrl = latestItem.media.thumbnail.url;
        } else if (latestItem.media.url && latestItem.media.type && latestItem.media.type.startsWith('image')) {
            imageUrl = latestItem.media.url;
        }
    }
    else if (latestItem.enclosure && latestItem.enclosure.url && latestItem.enclosure.type && latestItem.enclosure.type.startsWith('image')) {
        imageUrl = latestItem.enclosure.url;
    }
    else if (latestItem.image && latestItem.image.url) {
        imageUrl = latestItem.image.url;
    }
    else if (latestItem.itunes && latestItem.itunes.image && latestItem.itunes.image.url) {
        imageUrl = latestItem.itunes.image.url;
    }
    else if (latestItem.content) {
        imageUrl = extractImageUrlFromHtml(latestItem.content);
    } else if (latestItem.description) {
        imageUrl = extractImageUrlFromHtml(latestItem.description);
    }

    if (imageUrl) {
        embed.setImage(imageUrl);
    }
    try {
        await channel.send({ embeds: [embed] });
        console.log(`[RSS Poller] Posted new entry from "${feedTitle}" to #${channel.name} in "${guildName}".`);
    } catch (error) {
        if (error instanceof DiscordAPIError && error.code === 50013) { 
            console.error(`[RSS Poller] Missing permissions to send messages in channel #${channel.name} (${channel.id}) in guild "${guildName}" (${channel.guild.id}). Please check bot permissions and channel overwrites.`);
        } else {
            console.error(`[RSS Poller] Failed to send message to channel #${channel.name} in "${guildName}":`, error.message);
        }
    }
}

/**
 * Polls all registered RSS feeds for new entries.
 * @param {import('discord.js').Client} client The Discord client instance.
 */
export async function pollFeeds(client) {
    console.log('[RSS Poller] Starting feed check...');
    const allFeeds = await getAllFeeds(); 
    if (!(allFeeds instanceof Map)) {
        console.error('[RSS Poller] getAllFeeds did not return a Map. Skipping feed check.');
        return;
    }

    for (const [guildId, feeds] of allFeeds.entries()) {
        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) {
            console.warn(`[RSS Poller] Could not find guild ${guildId}, skipping.`);
            continue;
        }

        for (const feedConfig of feeds) {
            try {
                const feed = await parser.parseURL(feedConfig.url);
                if (!feed.items || feed.items.length === 0) continue;
                const latestItem = feed.items[0];
                const newGuid = latestItem.guid || latestItem.link || latestItem.title;

                if (feedConfig.lastGuid === null || (newGuid && newGuid !== feedConfig.lastGuid)) {
                    const channel = await guild.channels.fetch(feedConfig.channelId).catch(() => null);
                    if (channel && (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)) {
                        await sendLatestFeedEntry(feed, latestItem, channel, guild.name);
                    }
                    await updateLastGuid(guildId, feedConfig.url, feedConfig.channelId, newGuid);
                }
            } catch (error) {
                console.error(`[RSS Poller] Failed to process feed ${feedConfig.url} for guild ${guildId}:`, error.message);
            }
        }
    }
    console.log('[RSS Poller] Finished feed check.');
}

/**
 * Adds a new RSS feed and immediately posts the latest article to the specified channel.
 * @param {import('discord.js').Client} client The Discord client instance.
 * @param {string} guildId The ID of the Discord guild.
 * @param {string} channelId The ID of the Discord channel.
 * @param {string} rssUrl The URL of the RSS feed.
 * @returns {Promise<boolean>} True if the feed was added and the first article was posted successfully, false otherwise.
 */
export async function addAndPostFirstArticle(client, guildId, channelId, rssUrl) {
    try {
        const validation = await validateRssUrl(rssUrl);
        if (!validation.isValid) {
            console.error(`[RSS Add] Invalid RSS URL: ${rssUrl}`);
            return false;
        }

        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) {
            console.warn(`[RSS Add] Could not find guild ${guildId}.`);
            return false;
        }

        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel || !(channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)) {
            console.warn(`[RSS Add] Could not find text or announcement channel ${channelId} in guild ${guildId}.`);
            return false;
        }

        const feed = await parser.parseURL(rssUrl);
        if (!feed.items || feed.items.length === 0) {
            console.warn(`[RSS Add] Feed ${rssUrl} has no items.`);
            await addFeed(guildId, rssUrl, channelId, null, validation.title); 
            return false;
        }

        const latestItem = feed.items[0];
        const newGuid = latestItem.guid || latestItem.link || latestItem.title;

        const sendSuccess = await sendLatestFeedEntry(feed, latestItem, channel, guild.name);

        await addFeed(guildId, rssUrl, channelId, newGuid, validation.title); 
        console.log(`[RSS Add] Successfully added feed "${validation.title}" and posted first article to #${channel.name} in "${guild.name}".`);
        return true;
    } catch (error) {
        console.error(`[RSS Add] Error adding and posting first article for ${rssUrl}:`, error.message);
        return false;
    }
}