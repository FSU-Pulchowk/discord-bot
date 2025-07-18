import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('assignrole')
    .setDescription('Assigns a role to a user.')
    .addUserOption(option =>
        option.setName('target_user')
            .setDescription('The user to assign the role to')
            .setRequired(true))
    .addRoleOption(option =>
        option.setName('role')
            .setDescription('The role to assign')
            .setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles); 

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    const targetUser = interaction.options.getMember('target_user'); 
    const roleToAssign = interaction.options.getRole('role'); 

    if (!targetUser) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ Please mention a valid user to assign the role to.")], ephemeral: true });
    }
    if (!roleToAssign) { // This check might be redundant with addRoleOption but good for safety
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`❌ Role not found.`)], ephemeral: true });
    }

    if (!interaction.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription("❌ I don't have the 'Manage Roles' permission to perform this action.")], ephemeral: true });
    }
    if (interaction.guild.members.me.roles.highest.position <= roleToAssign.position) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ I cannot assign "${roleToAssign.name}" because my highest role is not above it in the role hierarchy.`)], ephemeral: true });
    }
    if (interaction.member.roles.highest.position <= roleToAssign.position && interaction.user.id !== interaction.guild.ownerId) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ You cannot assign "${roleToAssign.name}" because your highest role is not above it in the role hierarchy.`)], ephemeral: true });
    }
    if (targetUser.roles.cache.has(roleToAssign.id)) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`⚠️ ${targetUser.user.tag} already has the "${roleToAssign.name}" role.`)], ephemeral: true });
    }

    try {
        await targetUser.roles.add(roleToAssign, `Assigned by ${interaction.user.tag} using /assignrole command.`);
        interaction.reply({ embeds: [new EmbedBuilder().setColor('#00FF00').setDescription(`✅ Successfully assigned "${roleToAssign.name}" to ${targetUser.user.tag}.`)], ephemeral: true });
    } catch (error) {
        console.error("Error assigning role:", error);
        interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ An error occurred while assigning the role: ${error.message}`)], ephemeral: true });
    }
}