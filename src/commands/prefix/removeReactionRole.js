import { EmbedBuilder, PermissionsBitField } from 'discord.js';
import { Command } from '../../utils/Command.js';

class RemoveReactionRoleCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'removereactionrole',
            description: 'Removes a reaction role configuration.',
            permissions: [PermissionsBitField.Flags.Administrator, PermissionsBitField.Flags.ManageRoles],
            usage: '<message_id> <emoji>',
            aliases: ['delreactionrole', 'unsetreactionrole'],
            dbInstance: options.dbInstance,
        });
    }

    async execute(message, args) {
        if (args.length < 2) return this.sendUsage(message, `Example: \`${this.client.PREFIX}removereactionrole 123456789012345678 👍\``);
        const messageId = args[0];
        const emoji = args[1];

        this.db.run(`DELETE FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?`,
            [message.guild.id, messageId, emoji],
            function(err) {
                if (err) {
                    console.error('Error deleting reaction role from DB:', err.message);
                    return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error removing reaction role: ${err.message}`)] });
                }
                if (this.changes > 0) { 
                    message.reply({ embeds: [new EmbedBuilder().setColor('#00FF00').setTitle('✅ Reaction Role Removed').setDescription(`Reaction role for ${emoji} on message ID \`${messageId}\` removed.`)] });
                    
                    message.channel.messages.fetch(messageId)
                        .then(targetMsg => {
                            const emojiIdentifier = emoji.includes(':') ? emoji.split(':')[1] : emoji;
                            const botReaction = targetMsg.reactions.cache.get(emojiIdentifier);
                            if (botReaction && botReaction.me) { 
                                botReaction.users.remove(message.client.user.id)
                                    .catch(e => console.warn(`Could not remove bot's reaction from message ${messageId}:`, e.message));
                            }
                        })
                        .catch(e => console.warn(`Could not fetch message ${messageId} to remove bot reaction:`, e.message));
                } else {
                    message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`❌ No reaction role found for ${emoji} on message ID \`${messageId}\` in this server.`)] });
                }
            }
        );
    }
}

export { RemoveReactionRoleCommand };