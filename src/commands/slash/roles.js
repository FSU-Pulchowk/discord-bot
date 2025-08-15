import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('roles')
    .setDescription('Lists roles of yourself or a mentioned user.')
    .addUserOption(option =>
        option.setName('target_user')
            .setDescription('The user to list roles for (defaults to yourself)')
            .setRequired(false))
    .setDMPermission(false);

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    let user = interaction.options.getMember('target_user') || interaction.member;

    if (!user) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ User not found or could not determine target user.")], ephemeral: true });
    }

    const roles = user.roles.cache
        .filter(role => role.id !== interaction.guild.id)
        .sort((a, b) => b.position - a.position)
        .map(role => role.name);

    const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle(`Roles for ${user.user.tag}`)
        .setDescription(roles.length > 0 ? roles.join('\n') : 'No roles (besides @everyone).')
        .setThumbnail(user.user.displayAvatarURL({ dynamic: true }))
        .setTimestamp();
        
    interaction.reply({ embeds: [embed] }); // Can be ephemeral or public
}