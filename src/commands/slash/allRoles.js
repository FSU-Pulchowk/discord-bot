import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('allroles')
    .setDescription('Lists all roles in the server with their IDs.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles | PermissionsBitField.Flags.Administrator);

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles) && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    const allServerRoles = interaction.guild.roles.cache
        .filter(role => role.id !== interaction.guild.id && !role.managed)
        .sort((a, b) => b.position - a.position)
        .map(role => `${role.name} (ID: ${role.id})`);

    const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle(`All Roles in ${interaction.guild.name}`)
        .setDescription(allServerRoles.length > 0 ? allServerRoles.join('\n') : 'No custom roles found.')
        .setTimestamp();

    interaction.reply({ embeds: [embed] });
}