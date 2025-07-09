import { EmbedBuilder, PermissionsBitField } from 'discord.js';
import { Command } from '../../utils/Command.js';

class SetReactionRoleCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'setreactionrole',
            description: 'Sets up a reaction role on a message.',
            permissions: [PermissionsBitField.Flags.Administrator, PermissionsBitField.Flags.ManageRoles],
            usage: '<message_id> <emoji> <RoleNameOrID>',
            aliases: ['addreactionrole', 'reactionrole'],
            dbInstance: options.dbInstance,
        });
    }

    async execute(message, args) {
        if (args.length < 3) return this.sendUsage(message, `Example: \`${this.client.PREFIX}setreactionrole 123456789012345678 👍 @Member\``);
        
        const messageId = args[0];
        const emoji = args[1];
        const roleQuery = args.slice(2).join(' ');

        let targetMessage;
        try {
            targetMessage = await message.channel.messages.fetch(messageId);
        } catch (fetchError) {
            console.error(`Error fetching message ${messageId}:`, fetchError);
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Message with ID \`${messageId}\` not found in this channel.`)] });
        }

        const role = message.guild.roles.cache.find(r =>
            r.name.toLowerCase() === roleQuery.toLowerCase() || r.id === roleQuery
        );
        if (!role) return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`❌ Role "${roleQuery}" not found in this server.`)] });

        if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription("❌ I need the 'Manage Roles' permission to set up reaction roles.")] });
        }
        if (message.guild.members.me.roles.highest.position <= role.position) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ I cannot assign "${role.name}" because my highest role is not above it in the role hierarchy.`)] });
        }

        try {
            await targetMessage.react(emoji);
        } catch (reactError) {
            console.error('Error reacting for reaction role:', reactError);
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Failed to react with ${emoji}. Please ensure it's a valid emoji and I have permission to react.`)] });
        }

        this.db.run(`INSERT OR REPLACE INTO reaction_roles (guild_id, message_id, emoji, role_id) VALUES (?, ?, ?, ?)`,
            [message.guild.id, messageId, emoji, role.id],
            (err) => {
                if (err) {
                    console.error('Error saving reaction role to DB:', err.message);
                    return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error saving reaction role: ${err.message}`)] });
                }
                const embed = new EmbedBuilder()
                    .setColor('#00FF00') 
                    .setTitle('✅ Reaction Role Set')
                    .setDescription(`Reacting with ${emoji} on [this message](${targetMessage.url}) will now give the **${role.name}** role.`)
                    .addFields(
                        { name: 'Message ID', value: messageId, inline: true },
                        { name: 'Emoji', value: emoji, inline: true },
                        { name: 'Role', value: role.name, inline: true }
                    )
                    .setTimestamp();
                message.reply({ embeds: [embed] });
            }
        );
    }
}

export { SetReactionRoleCommand };