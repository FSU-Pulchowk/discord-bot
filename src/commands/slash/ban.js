import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bans a user from the server.')
    .addUserOption(option =>
        option.setName('target_user')
            .setDescription('The user to ban')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('reason')
            .setDescription('Reason for the ban (optional)')
            .setRequired(false))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.BanMembers);

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
        return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    const targetUser = interaction.options.getMember('target_user');
    const reason = interaction.options.getString('reason') || 'No reason provided.';

    if (!targetUser) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ Please mention a valid user to ban.")], ephemeral: true });
    }

    if (targetUser.id === interaction.user.id) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ You cannot ban yourself.")], ephemeral: true });
    }
    if (targetUser.id === interaction.client.user.id) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ I cannot ban myself.")], ephemeral: true });
    }
    if (targetUser.id === interaction.guild.ownerId) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription("❌ Cannot ban the server owner.")], ephemeral: true });
    }
    if (!targetUser.bannable) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ I cannot ban ${targetUser.user.tag} due to role hierarchy or insufficient permissions.`)], ephemeral: true });
    }
    if (targetUser.roles.highest.position >= interaction.member.roles.highest.position && interaction.user.id !== interaction.guild.ownerId) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription("❌ You cannot ban a user with a role equal to or higher than your own.")], ephemeral: true });
    }

    try {
        await interaction.guild.bans.create(targetUser.user, { reason: reason });
        interaction.reply({ embeds: [new EmbedBuilder().setColor('#00FF00').setDescription(`✅ Banned ${targetUser.user.tag} for: ${reason}`)], ephemeral: true });
    } catch (error) {
        console.error('Error banning user:', error);
        interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ An error occurred while banning the user: ${error.message}`)], ephemeral: true });
    }
}