import {
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('suggest')
  .setDescription('Submits a suggestion to the designated suggestions channel.')
  .addStringOption(option =>
    option.setName('suggestion_text')
      .setDescription('Your suggestion text')
      .setRequired(true)
  )
  .setDMPermission(false);

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    const suggestionText = interaction.options.getString('suggestion_text');
    const db = interaction.client.db;
    const guildId = interaction.guild.id;
    const userId = interaction.user.id;

    const confirmEmbed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('Confirm Your Suggestion')
        .setDescription('Please review your suggestion. Press "Confirm" to submit it to the suggestions channel.')
        .addFields({ name: 'Your Suggestion', value: suggestionText });

    const confirmButton = new ButtonBuilder()
        .setCustomId('confirm_suggestion')
        .setLabel('Confirm')
        .setStyle(ButtonStyle.Success);

    const cancelButton = new ButtonBuilder()
        .setCustomId('cancel_suggestion')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

    const confirmationMessage = await interaction.reply({
        embeds: [confirmEmbed],
        components: [row],
        ephemeral: true
    });

    const collector = confirmationMessage.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000
    });

    collector.on('collect', async i => {
        // Essential check: If already replied or deferred, skip to prevent "Interaction already acknowledged"
        if (i.replied || i.deferred) {
            console.warn(`[Suggest] Interaction ${i.customId} already acknowledged. Skipping.`);
            return;
        }

        if (i.user.id !== interaction.user.id) {
            return i.reply({ content: 'You cannot use these buttons.', ephemeral: true }).catch(() => {});
        }

        try {
            await i.deferUpdate(); // Acknowledge the button interaction
        } catch (err) {
            if (err.code === 10062) {
                console.warn('❗ [Suggest] Button interaction expired.');
                return; // Interaction expired, no further action needed for this interaction
            } else if (err.code === 40060) {
                console.warn('❗ [Suggest] Button interaction already acknowledged.');
                return; // Interaction already acknowledged, no further action needed
            } else {
                console.error('❌ [Suggest] Unknown error during deferUpdate():', err);
                return;
            }
        }

        const disabledRow = new ActionRowBuilder().addComponents(
            confirmButton.setDisabled(true),
            cancelButton.setDisabled(true)
        );
        // Safely edit the original confirmation message to disable buttons
        await confirmationMessage.edit({ components: [disabledRow] }).catch(e => {
            console.error('Error disabling buttons on confirmation message:', e);
        });

        if (i.customId === 'cancel_suggestion') {
            return interaction.followUp({
                content: '❌ Your suggestion has been cancelled.',
                ephemeral: true
            }).catch(() => {});
        }

        if (i.customId === 'confirm_suggestion') {
            const SUGGESTIONS_CHANNEL_ID = process.env.SUGGESTIONS_CHANNEL_ID;
            if (!SUGGESTIONS_CHANNEL_ID) {
                return interaction.followUp({
                    embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ Suggestion channel is not configured.')],
                    ephemeral: true
                }).catch(() => {});
            }

            const suggestionsChannel = interaction.guild.channels.cache.get(SUGGESTIONS_CHANNEL_ID);
            if (!suggestionsChannel || suggestionsChannel.type !== ChannelType.GuildText) {
                return interaction.followUp({
                    embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ Suggestion channel not found or is not a text channel.')],
                    ephemeral: true
                }).catch(() => {});
            }

            try {
                const suggestionEmbed = new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle('💡 New Suggestion')
                    .setDescription(suggestionText)
                    .addFields(
                        { name: 'Suggested By', value: interaction.user.tag, inline: true },
                        { name: 'Status', value: 'Pending', inline: true }
                    )
                    .setFooter({ text: `Suggestion ID: Pending | Votes: 👍 0 / 👎 0` })
                    .setTimestamp();

                const sentMessage = await suggestionsChannel.send({ embeds: [suggestionEmbed] });
                await sentMessage.react('👍');
                await sentMessage.react('👎');

                db.run(
                    `INSERT INTO suggestions (guild_id, message_id, user_id, suggestion_text, status, upvotes, downvotes, submitted_at)
                    VALUES (?, ?, ?, ?, ?, 0, 0, ?)`,
                    [guildId, sentMessage.id, userId, suggestionText, 'pending', Date.now()],
                    function (err) {
                        if (err) {
                            console.error('❌ DB error saving suggestion:', err.message);
                            sentMessage.delete().catch(() => {}); // Attempt to delete the partially sent message
                            return interaction.followUp({
                                embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ Error saving your suggestion.')],
                                ephemeral: true
                            }).catch(() => {});
                        }

                        const suggestionId = this.lastID;
                        const finalEmbed = EmbedBuilder.from(suggestionEmbed).setFooter({
                            text: `Suggestion ID: ${suggestionId} | Votes: 👍 0 / 👎 0`
                        });

                        const deleteButton = new ButtonBuilder()
                            .setCustomId(`delete_suggestion_${suggestionId}`)
                            .setLabel('Delete')
                            .setStyle(ButtonStyle.Danger)
                            .setEmoji('🗑️');

                        const suggestionRow = new ActionRowBuilder().addComponents(deleteButton);
                        sentMessage.edit({ embeds: [finalEmbed], components: [suggestionRow] }).catch(e => {
                            console.error('Error editing sent suggestion message with final ID and delete button:', e);
                        });

                        interaction.followUp({
                            embeds: [new EmbedBuilder().setColor('#00FF00').setDescription(`✅ Your suggestion #${suggestionId} was posted in <#${SUGGESTIONS_CHANNEL_ID}>.`)],
                            ephemeral: true
                        }).catch(() => {});
                    }
                );
            } catch (err) {
                console.error('❌ Failed to post suggestion:', err);
                interaction.followUp({
                    embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ An error occurred while posting your suggestion.')],
                    ephemeral: true
                }).catch(() => {});
            }
        }
    });

    collector.on('end', async collected => {
        if (collected.size === 0) {
            try {
                // Ensure the original message can be edited and is not already deleted/expired
                if (!confirmationMessage.deleted) {
                    await confirmationMessage.edit({
                        content: '⌛ You did not respond in time. Suggestion cancelled.',
                        embeds: [],
                        components: []
                    });
                }
            } catch (e) {
                console.warn('⚠️ Could not edit message after collector timeout:', e);
            }
        }
    });
}