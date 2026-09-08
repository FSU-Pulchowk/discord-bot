// src/commands/slash/react.js
// Slash command: /react
// Adds an emoji reaction to a target message, monitors it, and automatically
// removes the bot's own reaction as soon as another user reacts with the same emoji.

import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
} from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('react')
    .setDescription('React to a message with an emoji, automatically removed when someone else reacts')
    .addStringOption(option =>
        option
            .setName('message_id')
            .setDescription('The ID of the message to react to')
            .setRequired(true)
    )
    .addStringOption(option =>
        option
            .setName('emoji')
            .setDescription('The emoji to react with (unicode or custom)')
            .setRequired(true)
    );

/**
 * Execute the /react slash command
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
    const messageId = interaction.options.getString('message_id').trim();
    const emojiInput = interaction.options.getString('emoji').trim();

    // 1. Validate message ID format (Discord snowflakes are 17–20 digits)
    if (!/^\d{17,20}$/.test(messageId)) {
        return interaction.reply({
            content: '❌ Invalid `message_id`. A valid Discord message ID is a 17–20 digit number.',
            flags: MessageFlags.Ephemeral,
        });
    }

    // Defer reply ephemerally while fetching message and reacting
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // 2. Fetch the target message from the channel where the command was executed
    let targetMessage;
    try {
        targetMessage = await interaction.channel.messages.fetch(messageId);
    } catch (err) {
        let reason = 'Unable to find or access the message.';
        if (err.code === 10008) {
            reason = 'Message not found in this channel. Make sure the message ID is correct and from this channel.';
        } else if (err.code === 50001 || err.code === 50013) {
            reason = 'Missing permissions to read message history in this channel.';
        }
        return interaction.editReply(`❌ Could not fetch message: ${reason}`);
    }

    // 3. Add the reaction to the message
    let addedReaction;
    try {
        addedReaction = await targetMessage.react(emojiInput);
    } catch (err) {
        let reason = err.message;
        if (err.code === 10014) {
            reason = 'Unknown emoji. For custom emojis, ensure the bot has access to the server the emoji belongs to.';
        } else if (err.code === 50013) {
            reason = 'Missing `Add Reactions` or `Use External Emojis` permission.';
        }
        return interaction.editReply(`❌ Could not add reaction: ${reason}`);
    }

    // Identify the target emoji: custom emojis have an ID, unicode emojis only have a name
    const targetEmojiId = addedReaction.emoji.id;
    const targetEmojiName = addedReaction.emoji.name;

    /**
     * Check if a given reaction matches the one the bot added
     * @param {import('discord.js').MessageReaction} r
     */
    const isMatchingEmoji = (r) => {
        if (targetEmojiId) {
            return r.emoji.id === targetEmojiId;
        }
        return r.emoji.name === targetEmojiName;
    };

    // 4. Create an in-memory ReactionCollector on the target message
    // Collects when any user other than the bot reacts with the same emoji
    const collector = targetMessage.createReactionCollector({
        filter: (reaction, user) => {
            return isMatchingEmoji(reaction) && user.id !== interaction.client.user.id;
        },
        max: 1, // Automatically stops once 1 valid reaction is collected
        dispose: true, // Listen for reaction removal events as well
    });

    // When another user adds the same emoji
    collector.on('collect', async (reaction, user) => {
        try {
            // Remove ONLY the bot's own reaction
            await addedReaction.users.remove(interaction.client.user.id);
        } catch (err) {
            console.error(`[/react] Failed to remove bot reaction on message ${messageId}:`, err.message);
        } finally {
            collector.stop('user_reacted');
        }
    });

    // If the bot's reaction is removed before another user reacts
    collector.on('remove', (reaction, user) => {
        if (user.id === interaction.client.user.id && isMatchingEmoji(reaction)) {
            collector.stop('bot_reaction_removed');
        }
    });

    // Cleanup when collector stops
    collector.on('end', (collected, reason) => {
        // Collector cleanly stopped; no lingering listeners
    });

    return interaction.editReply({
        content: `✅ Successfully reacted with ${addedReaction.emoji.toString()} to [message](${targetMessage.url})!\nMonitoring is active: the reaction will automatically be removed when another user reacts with the same emoji.`,
    });
}
