import { EmbedBuilder, PermissionsBitField } from 'discord.js';
import { Command } from '../../utils/Command.js';

class BanCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'ban',
            description: 'Bans a user from the server.',
            permissions: [PermissionsBitField.Flags.BanMembers], // Requires Ban Members permission
            usage: '@user [reason]',
            dbInstance: options.dbInstance, // Not directly used in this command, but good practice
        });
    }

    async execute(message, args) {
        const targetUser = message.mentions.members.first();
        if (!targetUser) return this.sendUsage(message, 'Please mention a user to ban.');
        const reason = args.slice(1).join(' ') || 'No reason provided.';

        if (targetUser.id === message.author.id) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ You cannot ban yourself.")] });
        }
        if (targetUser.id === this.client.user.id) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ I cannot ban myself.")] });
        }
        if (targetUser.id === message.guild.ownerId) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription("❌ Cannot ban the server owner.")] });
        }
        if (!targetUser.bannable) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ I cannot ban ${targetUser.user.tag} due to role hierarchy or insufficient permissions.`)] });
        }
        if (targetUser.roles.highest.position >= message.member.roles.highest.position && message.author.id !== message.guild.ownerId) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription("❌ You cannot ban a user with a role equal to or higher than your own.")] });
        }

        try {
            await message.guild.bans.create(targetUser.user, { reason: reason });
            message.reply({ embeds: [new EmbedBuilder().setColor('#00FF00').setDescription(`✅ Banned ${targetUser.user.tag} for: ${reason}`)] });
        } catch (error) {
            console.error('Error banning user:', error);
            message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ An error occurred while banning the user: ${error.message}`)] });
        }
    }
}

export { BanCommand };