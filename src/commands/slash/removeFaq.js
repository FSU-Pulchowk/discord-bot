import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('removefaq')
    .setDescription('Removes an FAQ by its ID.')
    .addIntegerOption(option =>
        option.setName('faq_id')
            .setDescription('The ID of the FAQ to remove')
            .setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild);

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    const faqId = interaction.options.getInteger('faq_id');
    const guildId = interaction.guild.id;
    const db = interaction.client.db;

    db.run(`DELETE FROM faqs WHERE id = ? AND guild_id = ?`, [faqId, guildId], function(err) {
        if (err) {
            console.error('Error deleting FAQ:', err.message);
            return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error deleting FAQ: ${err.message}`)], ephemeral: true });
        }
        if (this.changes > 0) {
            interaction.reply({ embeds: [new EmbedBuilder().setColor('#00FF00').setTitle('✅ FAQ Removed').setDescription(`FAQ ID **#${faqId}** has been successfully removed.`)], ephemeral: true });
        } else {
            interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`❌ No FAQ with ID **#${faqId}** found for this server.`)], ephemeral: true });
        }
    });
}