import { EmbedBuilder, ChannelType } from 'discord.js';
import { Command } from '../../utils/Command.js';
import dotenv from 'dotenv';

dotenv.config(); // Ensure dotenv is loaded for this module

class SuggestCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'suggest',
            description: 'Submits a suggestion to the designated suggestions channel.',
            permissions: [], // No specific permissions required for users to suggest
            usage: '<your suggestion>',
            aliases: ['idea'],
            dbInstance: options.dbInstance,
        });
        this.SUGGESTIONS_CHANNEL_ID = process.env.SUGGESTIONS_CHANNEL_ID || '';
    }

    async execute(message, args) {
        const suggestionText = args.join(' ');
        if (!suggestionText) return this.sendUsage(message, 'Please provide your suggestion text.');
        
        if (this.SUGGESTIONS_CHANNEL_ID === '') {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ The suggestions channel ID is not configured by the bot owner. Please contact an admin.')] });
        }

        const suggestionsChannel = message.guild.channels.cache.get(this.SUGGESTIONS_CHANNEL_ID);
        if (!suggestionsChannel || suggestionsChannel.type !== ChannelType.GuildText) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ The configured suggestions channel was not found or is not a text channel. Please contact an admin.')] });
        }
        
        if (!suggestionsChannel.permissionsFor(this.client.user).has('SendMessages')) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ I do not have permission to send messages in the configured suggestions channel (<#${this.SUGGESTIONS_CHANNEL_ID}>).`)] });
        }

        try {
            const tempEmbed = new EmbedBuilder()
                .setColor('#0099ff') // Blue
                .setTitle('💡 New Suggestion')
                .setDescription(suggestionText)
                .addFields(
                    { name: 'Suggested By', value: message.author.tag, inline: true },
                    { name: 'Status', value: 'Pending', inline: true }
                )
                .setFooter({ text: `Suggestion ID: Pending | Votes: 👍 0 / 👎 0` }) // ID will be updated later
                .setTimestamp();
            
            const sentMessage = await suggestionsChannel.send({ embeds: [tempEmbed] });
            
            await sentMessage.react('👍');
            await sentMessage.react('👎');

            this.db.run(`INSERT INTO suggestions (guild_id, message_id, user_id, suggestion_text, status, upvotes, downvotes, created_at) VALUES (?, ?, ?, ?, ?, 0, 0, ?)`,
                [message.guild.id, sentMessage.id, message.author.id, suggestionText, 'pending', Date.now()],
                function(err) {
                    if (err) {
                        console.error('Error saving suggestion to database:', err.message);
                        sentMessage.delete().catch(console.warn); 
                        return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ An error occurred while saving your suggestion: ${err.message}`)] });
                    }
                    const finalEmbed = EmbedBuilder.from(tempEmbed).setFooter({ text: `Suggestion ID: ${this.lastID} | Votes: 👍 0 / 👎 0` });
                    sentMessage.edit({ embeds: [finalEmbed] }).catch(console.warn);

                    message.reply({ embeds: [new EmbedBuilder().setColor('#00FF00').setDescription(`✅ Your suggestion **#${this.lastID}** has been submitted to ${suggestionsChannel}!`)] }).catch(console.error);
                }
            );
        } catch (error) {
            console.error('Error processing suggestion command:', error);
            message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ An unexpected error occurred: ${error.message}`)] });
        }
    }
}

export { SuggestCommand };