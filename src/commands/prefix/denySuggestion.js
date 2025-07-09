import { EmbedBuilder, PermissionsBitField, ChannelType } from 'discord.js';
import { Command } from '../../utils/Command.js';
import dotenv from 'dotenv';

dotenv.config(); 
class DenySuggestionCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'denysuggestion',
            description: 'Denies a suggestion by its ID.',
            permissions: [PermissionsBitField.Flags.Administrator, PermissionsBitField.Flags.ManageGuild],
            usage: '<suggestion ID> [reason]',
            dbInstance: options.dbInstance,
        });
        this.SUGGESTIONS_CHANNEL_ID = process.env.SUGGESTIONS_CHANNEL_ID || 'YOUR_SUGGESTIONS_CHANNEL_ID_HERE';
    }

    async execute(message, args) {
        const suggestionId = parseInt(args[0]);
        if (isNaN(suggestionId)) return this.sendUsage(message, 'Please provide a valid suggestion ID.');
        const reason = args.slice(1).join(' ') || 'No reason provided.';

        this.db.get(`SELECT * FROM suggestions WHERE id = ? AND guild_id = ?`, [suggestionId, message.guild.id], async (err, row) => {
            if (err) {
                console.error('Error fetching suggestion:', err.message);
                return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error fetching suggestion: ${err.message}`)] });
            }
            if (!row) return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`❌ No suggestion ID **#${suggestionId}** found.`)] });
            if (row.status === 'denied') return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`⚠️ Suggestion **#${suggestionId}** is already denied.`)] });

            this.db.run(`UPDATE suggestions SET status = 'denied', reviewed_by = ?, reviewed_at = ?, reason = ? WHERE id = ?`,
                [message.author.id, Date.now(), reason, suggestionId],
                async (updateErr) => {
                    if (updateErr) {
                        console.error('Error updating suggestion:', updateErr.message);
                        return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error denying suggestion: ${updateErr.message}`)] });
                    }

                    if (this.SUGGESTIONS_CHANNEL_ID === 'YOUR_SUGGESTIONS_CHANNEL_ID_HERE') {
                         message.channel.send(`⚠️ Suggestion **#${suggestionId}** denied. Original message not updated as SUGGESTIONS_CHANNEL_ID is not configured in .env.`).catch(console.error);
                    } else {
                        const suggestionsChannel = message.guild.channels.cache.get(this.SUGGESTIONS_CHANNEL_ID);
                        if (suggestionsChannel && suggestionsChannel.type === ChannelType.GuildText && row.message_id) {
                            try {
                                const suggestionMessage = await suggestionsChannel.messages.fetch(row.message_id);
                                if (suggestionMessage && suggestionMessage.embeds[0]) {
                                    const originalEmbed = suggestionMessage.embeds[0];
                                    const statusIndex = originalEmbed.fields.findIndex(f => f.name.toLowerCase() === 'status');
                                    const newEmbed = EmbedBuilder.from(originalEmbed).setColor('#FF0000'); // Red for denied

                                    if (statusIndex > -1) {
                                        newEmbed.spliceFields(statusIndex, 1, { name: 'Status', value: `Denied by ${message.author.tag} ${reason !== 'No reason provided.' ? `(${reason})` : ''}`, inline: true });
                                    } else {
                                        newEmbed.addFields({ name: 'Status', value: `Denied by ${message.author.tag} ${reason !== 'No reason provided.' ? `(${reason})` : ''}`, inline: true });
                                    }
                                    newEmbed.setFooter({ text: `Suggestion ID: ${row.id} | Upvotes: ${row.upvotes || 0} | Downvotes: ${row.downvotes || 0} | Denied` });
                                    await suggestionMessage.edit({ embeds: [newEmbed] });
                                }
                            } catch (msgError) {
                                console.error(`Error updating suggestion message ${row.message_id}:`, msgError);
                                message.channel.send(`⚠️ Suggestion **#${suggestionId}** denied, but failed to update original message (might be deleted or bot lacks permissions).`).catch(console.error);
                            }
                        } else {
                             message.channel.send(`⚠️ Suggestion **#${suggestionId}** denied. Original message not updated (suggestions channel not found/text channel, or message ID missing).`).catch(console.error);
                        }
                    }

                    const confirmEmbed = new EmbedBuilder().setColor('#FF0000').setTitle('❌ Suggestion Denied').setDescription(`Suggestion **#${suggestionId}**: \`${row.suggestion_text}\` denied.`)
                        .addFields(
                            { name: 'Denied By', value: message.author.tag, inline: true },
                            { name: 'Reason', value: reason, inline: true }
                        ).setTimestamp();
                    message.reply({ embeds: [confirmEmbed] });
                }
            );
        });
    }
}

export { DenySuggestionCommand };