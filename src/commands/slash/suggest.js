import { SlashCommandBuilder, EmbedBuilder, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Submits a suggestion to the designated suggestions channel.')
    .addStringOption(option =>
        option.setName('suggestion_text')
            .setDescription('Your suggestion text')
            .setRequired(true))
    .setDMPermission(false);

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    const suggestionText = interaction.options.getString('suggestion_text');
    const guildId = interaction.guild.id;
    const userId = interaction.user.id;
    const db = interaction.client.db;

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
        // Ensure it's the original user interacting
        if (i.user.id !== interaction.user.id) {
            await i.reply({ content: 'You cannot use these buttons.', ephemeral: true });
            return;
        }
        const disabledRow = new ActionRowBuilder().addComponents(
            confirmButton.setDisabled(true),
            cancelButton.setDisabled(true)
        );
        await i.update({ components: [disabledRow] });

        if (i.customId === 'confirm_suggestion') {
            const SUGGESTIONS_CHANNEL_ID = process.env.SUGGESTIONS_CHANNEL_ID || '';
            if (!SUGGESTIONS_CHANNEL_ID) {
                return i.followUp({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ The suggestions channel ID is not configured.')], ephemeral: true });
            }
            const suggestionsChannel = interaction.guild.channels.cache.get(SUGGESTIONS_CHANNEL_ID);
            if (!suggestionsChannel || suggestionsChannel.type !== ChannelType.GuildText) {
                return i.followUp({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ The configured suggestions channel was not found or is not a text channel.')], ephemeral: true });
            }
            if (!suggestionsChannel.permissionsFor(interaction.client.user).has('SendMessages')) {
                return i.followUp({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ I do not have permission to send messages in the configured suggestions channel.`)], ephemeral: true });
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

                db.run(`INSERT INTO suggestions (guild_id, message_id, user_id, suggestion_text, status, upvotes, downvotes, created_at) VALUES (?, ?, ?, ?, ?, 0, 0, ?)`,
                    [guildId, sentMessage.id, userId, suggestionText, 'pending', Date.now()],
                    function (err) {
                        if (err) {
                            console.error('Error saving suggestion to database:', err.message);
                            sentMessage.delete().catch(console.warn);
                            i.followUp({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ An error occurred while saving your suggestion.`)], ephemeral: true });
                            return;
                        }
                        const suggestionId = this.lastID;
                        const finalEmbed = EmbedBuilder.from(suggestionEmbed).setFooter({ text: `Suggestion ID: ${suggestionId} | Votes: 👍 0 / 👎 0` });
                        
                        const deleteButton = new ButtonBuilder()
                            .setCustomId(`delete_suggestion_${suggestionId}`)
                            .setLabel('Delete')
                            .setStyle(ButtonStyle.Danger)
                            .setEmoji('🗑️');
                        
                        const suggestionRow = new ActionRowBuilder().addComponents(deleteButton);
                        
                        sentMessage.edit({ embeds: [finalEmbed], components: [suggestionRow] }).catch(console.warn);
                        
                        i.followUp({ embeds: [new EmbedBuilder().setColor('#00FF00').setDescription(`✅ Your suggestion **#${suggestionId}** has been submitted to <#${SUGGESTIONS_CHANNEL_ID}>!`)], ephemeral: true });
                    }
                );
            } catch (error) {
                console.error('Error processing suggestion submission:', error);
                i.followUp({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ An unexpected error occurred during submission.`)], ephemeral: true });
            }
        } else if (i.customId === 'cancel_suggestion') {
            await i.followUp({ content: 'Your suggestion has been cancelled.', ephemeral: true });
        }
    });

    collector.on('end', collected => {
        if (collected.size === 0) {
            interaction.editReply({
                content: 'You did not respond in time. Your suggestion has been cancelled.',
                embeds: [],
                components: []
            }).catch(console.error);
        }
    });
}