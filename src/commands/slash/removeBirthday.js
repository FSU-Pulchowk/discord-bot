import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('removebirthday')
    .setDescription('Removes your birthday from announcements.')
    .setDMPermission(false); 

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    const userId = interaction.user.id;
    const guildId = interaction.guild.id;
    const db = interaction.client.db;

    db.run(`DELETE FROM birthdays WHERE user_id = ? AND guild_id = ?`, [userId, guildId], function(err) {
        if (err) {
            console.error('Error removing birthday:', err.message);
            return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error removing your birthday: ${err.message}`)], ephemeral: true });
        }
        if (this.changes > 0) {
            interaction.reply({ embeds: [new EmbedBuilder().setColor('#00FF00').setTitle('🗑️ Birthday Removed').setDescription('Your birthday has been successfully removed from the announcement list.')], ephemeral: true });
        } else {
            interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription('❌ No birthday was found for you to remove in this server.')], ephemeral: true });
        }
    });
}