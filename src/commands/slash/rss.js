import { SlashCommandBuilder, EmbedBuilder, ChannelType, PermissionFlagsBits }  from 'discord.js';
import { addFeed, removeFeed, getGuildFeeds } from '../../services/rssDbManager.js';
import { validateRssUrl, addAndPostFirstArticle } from '../../services/rssService.js'; // Changed pollFeeds to addAndPostFirstArticle

/**
 * Defines the RSS slash command and its subcommands.
 * This command allows administrators to manage RSS feed subscriptions for their guild,
 * including adding new feeds, removing existing ones, and listing all subscribed feeds.
 */
export const data = new SlashCommandBuilder()
    .setName('rss')
    .setDescription('Manage RSS feed subscriptions.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels) // Requires 'Manage Channels' permission by default for all subcommands
    .addSubcommand(subcommand =>
        subcommand
            .setName('add')
            .setDescription('Subscribes a new RSS feed to a channel.')
            .addStringOption(option =>
                option.setName('url')
                    .setDescription('The URL of the RSS or Atom feed.')
                    .setRequired(true))
            .addChannelOption(option =>
                option.setName('channel')
                    .setDescription('The text or announcement channel to post updates to (defaults to current channel).')
                    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                    .setRequired(false)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('remove')
            .setDescription('Removes an RSS feed subscription from this guild.')
            .addStringOption(option =>
                option.setName('url')
                    .setDescription('The URL of the RSS or Atom feed to remove.')
                    .setRequired(true)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('list')
            .setDescription('Lists all RSS feeds subscribed in this guild.'));

/**
 * Executes the RSS command based on the subcommand chosen by the user.
 * Handles adding, removing, and listing RSS feed subscriptions.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction The interaction object representing the command execution.
 */
export async function execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({
            content: '❌ You must have the "Manage Server" permission to use this command.',
            ephemeral: true
        }).catch(e => console.error("Error replying to permission check:", e));
        return;
    }
    try {
        await interaction.deferReply({ ephemeral: true });
    } catch (e) {
        if (e.code === 40060) {
            console.warn(`[RSS Command] Interaction for ${interaction.commandName} was already acknowledged. Proceeding with editReply.`);
        } else {
            console.error(`[RSS Command] Unexpected error deferring reply for ${interaction.commandName}:`, e);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '❌ An internal error occurred while preparing the command response.', ephemeral: true }).catch(e2 => console.error("Error sending fallback reply after unexpected defer failure:", e2));
            }
            throw e; 
        }
    }

    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    if (!guildId) {
        return interaction.editReply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    /**
     * Handles the 'add' subcommand: Subscribes a new RSS feed.
     */
    if (subcommand === 'add') {
        const url = interaction.options.getString('url');
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        if (!(channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)) {
            return interaction.editReply({ content: 'Feeds can only be posted to text or announcement channels.', ephemeral: true });
        }
        try {
            // Use the new addAndPostFirstArticle function
            const success = await addAndPostFirstArticle(interaction.client, guildId, channel.id, url);

            if (success) {
                const feeds = await getGuildFeeds(guildId);
                const addedFeed = feeds.find(f => f.url === url && f.channelId === channel.id);
                const feedTitle = addedFeed ? addedFeed.title : 'Untitled Feed';
                const successEmbed = new EmbedBuilder()
                    .setColor('#2ECC71') 
                    .setTitle('✅ RSS Feed Subscribed!')
                    .setDescription(`I have posted the latest article from **${feedTitle}** to the ${channel} channel. I will now post future updates here.`)
                    .addFields({ name: 'Feed URL', value: url })
                    .setTimestamp();

                await interaction.editReply({ embeds: [successEmbed] });
            } else {
                return interaction.editReply({ content: `❌ Failed to add RSS feed. Please check the URL, bot permissions, or if it's already subscribed.` });
            }

        } catch (error) {
            console.error(`Error adding RSS feed for guild ${guildId}:`, error);
            if (error.message && error.message.includes('UNIQUE constraint failed')) {
                return interaction.editReply({ content: `❌ This RSS feed is already subscribed in <#${channel.id}>.` });
            }
            return interaction.editReply({ content: `❌ An unexpected error occurred while adding the feed: ${error.message}` });
        }
    }
    /**
     * Handles the 'remove' subcommand: Removes an existing RSS feed subscription.
     */
    else if (subcommand === 'remove') {
        const url = interaction.options.getString('url');

        try {
            const wasRemoved = await removeFeed(guildId, url);
            if (wasRemoved) {
                return interaction.editReply({ content: `✅ Successfully removed RSS feed: \`${url}\`.` });
            } else {
                return interaction.editReply({ content: `❌ Could not find an RSS feed with that URL to remove in this guild.` });
            }
        } catch (error) {
            console.error(`Error removing RSS feed for guild ${guildId}:`, error);
            return interaction.editReply({ content: `❌ An error occurred while trying to remove the RSS feed: ${error.message}` });
        }
    }
    /**
     * Handles the 'list' subcommand: Displays all RSS feeds subscribed in the current guild.
     */
    else if (subcommand === 'list') {
        try {
            const feeds = await getGuildFeeds(guildId);
            if (!feeds || feeds.length === 0) {
                return interaction.editReply({ content: 'ℹ️ No RSS feeds subscribed in this guild.' });
            }
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle(`📰 RSS Feeds for ${interaction.guild.name}`)
                .setDescription(
                    feeds.map(feed => {
                        const feedTitle = feed.title ? `**${feed.title}**` : `\`${feed.url}\``;
                        return `- ${feedTitle} in <#${feed.channelId}> (URL: ${feed.url})`;
                    }).join('\n')
                )
                .setTimestamp()
                .setFooter({ text: `Total Feeds: ${feeds.length}` });

            return interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error(`Error listing RSS feeds for guild ${guildId}:`, error);
            return interaction.editReply({ content: `❌ An error occurred while trying to list RSS feeds: ${error.message}` });
        }
    }
}