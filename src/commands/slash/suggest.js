import { SlashCommandBuilder, EmbedBuilder, ChannelType } from 'discord.js';

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

    const SUGGESTIONS_CHANNEL_ID = process.env.SUGGESTIONS_CHANNEL_ID || '';

    if (SUGGESTIONS_CHANNEL_ID === '') {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ The suggestions channel ID is not configured by the bot owner. Please contact an admin.')], ephemeral: true });
    }

    const suggestionsChannel = interaction.guild.channels.cache.get(SUGGESTIONS_CHANNEL_ID);
    if (!suggestionsChannel || suggestionsChannel.type !== ChannelType.GuildText) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ The configured suggestions channel was not found or is not a text channel. Please contact an admin.')], ephemeral: true });
    }
    
    if (!suggestionsChannel.permissionsFor(interaction.client.user).has('SendMessages')) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ I do not have permission to send messages in the configured suggestions channel (<#${SUGGESTIONS_CHANNEL_ID}>).`)], ephemeral: true });
    }

    try {
        const tempEmbed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('💡 New Suggestion')
            .setDescription(suggestionText)
            .addFields(
                { name: 'Suggested By', value: interaction.user.tag, inline: true },
                { name: 'Status', value: 'Pending', inline: true }
            )
            .setFooter({ text: `Suggestion ID: Pending | Votes: 👍 0 / 👎 0` })
            .setTimestamp();
        
        await interaction.deferReply({ ephemeral: true }); // Defer initial reply as sending message + reacting takes time

        const sentMessage = await suggestionsChannel.send({ embeds: [tempEmbed] });
        
        await sentMessage.react('👍');
        await sentMessage.react('👎');

        db.run(`INSERT INTO suggestions (guild_id, message_id, user_id, suggestion_text, status, upvotes, downvotes, created_at) VALUES (?, ?, ?, ?, ?, 0, 0, ?)`,
            [guildId, sentMessage.id, userId, suggestionText, 'pending', Date.now()],
            function(err) {
                if (err) {
                    console.error('Error saving suggestion to database:', err.message);
                    sentMessage.delete().catch(console.warn); 
                    return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ An error occurred while saving your suggestion: ${err.message}`)] });
                }
                const finalEmbed = EmbedBuilder.from(tempEmbed).setFooter({ text: `Suggestion ID: ${this.lastID} | Votes: 👍 0 / 👎 0` });
                sentMessage.edit({ embeds: [finalEmbed] }).catch(console.warn);

                interaction.editReply({ embeds: [new EmbedBuilder().setColor('#00FF00').setDescription(`✅ Your suggestion **#${this.lastID}** has been submitted to <#${SUGGESTIONS_CHANNEL_ID}>!`)] }).catch(console.error);
            }
        );
    } catch (error) {
        console.error('Error processing suggestion command:', error);
        if (interaction.deferred || interaction.replied) {
            interaction.editReply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ An unexpected error occurred: ${error.message}`)] }).catch(console.error);
        } else {
            interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ An unexpected error occurred: ${error.message}`)], ephemeral: true }).catch(console.error);
        }
    }
}
