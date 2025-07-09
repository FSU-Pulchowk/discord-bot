import { EmbedBuilder, PermissionsBitField } from 'discord.js';
import { Command } from '../../utils/Command.js';

class KickCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'kick',
            description: 'Kicks a user from the server.',
            permissions: [PermissionsBitField.Flags.KickMembers],
            usage: '@user [reason]',
            dbInstance: options.dbInstance,
        });
    }

    async execute(message, args) {
        const targetUser = message.mentions.members.first();
        if (!targetUser) return this.sendUsage(message, 'Please mention a user to kick.');
        const reason = args.slice(1).join(' ') || 'No reason provided.';

        if (targetUser.id === message.author.id) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ You cannot kick yourself.")] });
        }
        if (targetUser.id === this.client.user.id) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ I cannot kick myself.")] });
        }
        if (targetUser.id === message.guild.ownerId) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription("❌ Cannot kick the server owner.")] });
        }
        if (!targetUser.kickable) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ I cannot kick ${targetUser.user.tag} due to role hierarchy or insufficient permissions.`)] });
        }
        if (targetUser.roles.highest.position >= message.member.roles.highest.position && message.author.id !== message.guild.ownerId) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription("❌ You cannot kick a user with a role equal to or higher than your own.")] });
        }

        try {
            await targetUser.kick(reason);
            message.reply({ embeds: [new EmbedBuilder().setColor('#00FF00').setDescription(`✅ Kicked ${targetUser.user.tag} for: ${reason}`)] });
        } catch (error) {
            console.error('Error kicking user:', error);
            message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ An error occurred while kicking the user: ${error.message}`)] });
        }
    }
}

export { KickCommand };