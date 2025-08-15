import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Times out a user for a specified duration (e.g., 10m, 1h, 1d).')
    .addUserOption(option =>
        option.setName('target_user')
            .setDescription('The user to timeout')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('duration')
            .setDescription('Duration of timeout (e.g., 5s, 10m, 1h, 1d)')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('reason')
            .setDescription('Reason for the timeout (optional)')
            .setRequired(false))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers);

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    const targetUser = interaction.options.getMember('target_user');
    const durationString = interaction.options.getString('duration');
    const reason = interaction.options.getString('reason') || 'No reason provided.';

    let durationMs = 0;
    const match = durationString.match(/^(\d+)([smhd])$/i);

    if (!match) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription('❌ Invalid duration format. Use like `10s`, `5m`, `2h`, `1d`.')], ephemeral: true });
    }

    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();

    if (unit === 's') durationMs = value * 1000;
    else if (unit === 'm') durationMs = value * 60 * 1000;
    else if (unit === 'h') durationMs = value * 60 * 60 * 1000;
    else if (unit === 'd') durationMs = value * 24 * 60 * 60 * 1000;

    if (durationMs === 0 || durationMs > 28 * 24 * 60 * 60 * 1000) { // Max 28 days
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription('❌ Duration must be between 1 second and 28 days.')], ephemeral: true });
    }

    if (!targetUser) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ Please mention a valid user to timeout.")], ephemeral: true });
    }
    if (targetUser.id === interaction.user.id) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ You cannot timeout yourself.")], ephemeral: true });
    }
    if (targetUser.id === interaction.client.user.id) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ I cannot timeout myself.")], ephemeral: true });
    }
    if (targetUser.id === interaction.guild.ownerId) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription("❌ Cannot timeout the server owner.")], ephemeral: true });
    }
    if (!targetUser.moderatable) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ I cannot timeout ${targetUser.user.tag} due to role hierarchy or insufficient permissions.`)], ephemeral: true });
    }
    if (targetUser.roles.highest.position >= interaction.member.roles.highest.position && interaction.user.id !== interaction.guild.ownerId) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription("❌ You cannot timeout a user with a role equal to or higher than your own.")], ephemeral: true });
    }

    try {
        await targetUser.timeout(durationMs, reason);
        interaction.reply({ embeds: [new EmbedBuilder().setColor('#00FF00').setDescription(`✅ Timed out ${targetUser.user.tag} for ${durationString}. Reason: ${reason}`)], ephemeral: true });
    } catch (error) {
        console.error('Error timing out user:', error);
        interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ An error occurred while timing out: ${error.message}`)], ephemeral: true });
    }
}
