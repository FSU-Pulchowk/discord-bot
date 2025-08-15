import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('removerole')
    .setDescription('Removes a role from a user.')
    .addUserOption(option =>
        option.setName('target_user')
            .setDescription('The user to remove the role from')
            .setRequired(true))
    .addRoleOption(option =>
        option.setName('role')
            .setDescription('The role to remove')
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
    const roleToRemove = interaction.options.getRole('role');

    if (!targetUser) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ Please mention a valid user to remove the role from.")], ephemeral: true });
    }
    if (!roleToRemove) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`❌ Role not found.`)], ephemeral: true });
    }
    
    if (!targetUser.roles.cache.has(roleToRemove.id)) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`❌ ${targetUser.user.tag} does not have the "${roleToRemove.name}" role.`)], ephemeral: true });
    }

    if (!interaction.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription("❌ I don't have the 'Manage Roles' permission to perform this action.")], ephemeral: true });
    }
    if (interaction.guild.members.me.roles.highest.position <= roleToRemove.position) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ I cannot remove "${roleToRemove.name}" because my highest role is not above it in the role hierarchy.`)], ephemeral: true });
    }
    if (interaction.member.roles.highest.position <= roleToRemove.position && interaction.user.id !== interaction.guild.ownerId) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription("❌ You cannot remove a user with a role equal to or higher than your own.")], ephemeral: true });
    }

    try {
        await targetUser.roles.remove(roleToRemove, `Removed by ${interaction.user.tag} using /removerole command.`);
        interaction.reply({ embeds: [new EmbedBuilder().setColor('#00FF00').setDescription(`✅ Successfully removed "${roleToRemove.name}" from ${targetUser.user.tag}.`)], ephemeral: true });
    } catch (error) {
        console.error("Error removing role:", error);
        interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ An error occurred while removing the role: ${error.message}`)], ephemeral: true });
    }
}
