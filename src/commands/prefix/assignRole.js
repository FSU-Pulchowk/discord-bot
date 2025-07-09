import { EmbedBuilder, PermissionsBitField } from 'discord.js';
import { Command } from '../../utils/Command.js';

class AssignRoleCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'assignrole',
            description: 'Assigns a role to a user.',
            permissions: [PermissionsBitField.Flags.ManageRoles],
            usage: '@user <RoleNameOrID>',
            dbInstance: options.dbInstance, 
        });
    }

    async execute(message, args) {
        if (args.length < 2) return this.sendUsage(message);

        const targetUser = message.mentions.members.first();
        if (!targetUser) return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ Please mention a valid user to assign the role to.")] });

        const roleQuery = args.slice(1).join(' '); 
        const roleToAssign = message.guild.roles.cache.find(role =>
            role.name.toLowerCase() === roleQuery.toLowerCase() || role.id === roleQuery
        );
        if (!roleToAssign) return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`❌ Role "${roleQuery}" not found in this server.`)] });

        if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription("❌ I don't have the 'Manage Roles' permission to perform this action.")] });
        }
        if (message.guild.members.me.roles.highest.position <= roleToAssign.position) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ I cannot assign "${roleToAssign.name}" because my highest role is not above it in the role hierarchy.`)] });
        }
        if (message.member.roles.highest.position <= roleToAssign.position && message.author.id !== message.guild.ownerId) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ You cannot assign "${roleToAssign.name}" because your highest role is not above it in the role hierarchy.`)] });
        }
        if (targetUser.roles.cache.has(roleToAssign.id)) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`⚠️ ${targetUser.user.tag} already has the "${roleToAssign.name}" role.`)] });
        }

        try {
            await targetUser.roles.add(roleToAssign, `Assigned by ${message.author.tag} using !assignrole command.`);
            message.reply({ embeds: [new EmbedBuilder().setColor('#00FF00').setDescription(`✅ Successfully assigned "${roleToAssign.name}" to ${targetUser.user.tag}.`)] });
        } catch (error) {
            console.error("Error assigning role:", error);
            message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ An error occurred while assigning the role: ${error.message}`)] });
        }
    }
}

export { AssignRoleCommand };