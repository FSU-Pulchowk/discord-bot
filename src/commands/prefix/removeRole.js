import { EmbedBuilder, PermissionsBitField } from 'discord.js';
import { Command } from '../../utils/Command.js';

class RemoveRoleCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'removerole',
            description: 'Removes a role from a user.',
            permissions: [PermissionsBitField.Flags.ManageRoles],
            usage: '@user <RoleNameOrID>',
            aliases: ['derole', 'unrole'],
            dbInstance: options.dbInstance,
        });
    }

    async execute(message, args) {
        if (args.length < 2) return this.sendUsage(message);

        const targetUser = message.mentions.members.first();
        if (!targetUser) return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ Please mention a valid user to remove the role from.")] });

        const roleQuery = args.slice(1).join(' ');
        const roleToRemove = message.guild.roles.cache.find(role =>
            role.name.toLowerCase() === roleQuery.toLowerCase() || role.id === roleQuery
        );
        if (!roleToRemove) return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`❌ Role "${roleQuery}" not found in this server.`)] });
        
        if (!targetUser.roles.cache.has(roleToRemove.id)) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`❌ ${targetUser.user.tag} does not have the "${roleToRemove.name}" role.`)] });
        }

        if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription("❌ I don't have the 'Manage Roles' permission to perform this action.")] });
        }
        if (message.guild.members.me.roles.highest.position <= roleToRemove.position) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ I cannot remove "${roleToRemove.name}" because my highest role is not above it in the role hierarchy.`)] });
        }
        if (message.member.roles.highest.position <= roleToRemove.position && message.author.id !== message.guild.ownerId) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ You cannot remove "${roleToRemove.name}" because your highest role is not above it in the role hierarchy.`)] });
        }

        try {
            await targetUser.roles.remove(roleToRemove, `Removed by ${message.author.tag} using !removerole command.`);
            message.reply({ embeds: [new EmbedBuilder().setColor('#00FF00').setDescription(`✅ Successfully removed "${roleToRemove.name}" from ${targetUser.user.tag}.`)] });
        } catch (error) {
            console.error("Error removing role:", error);
            message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ An error occurred while removing the role: ${error.message}`)] });
        }
    }
}

export { RemoveRoleCommand };