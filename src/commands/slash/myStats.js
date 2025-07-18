import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('mystats')
    .setDescription('Displays your message count and voice chat time.')
    .setDMPermission(false);

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    const userId = interaction.user.id;
    const guildId = interaction.guild.id;
    const db = interaction.client.db;

    db.get(`SELECT messages_sent, voice_time_minutes FROM user_stats WHERE user_id = ? AND guild_id = ?`,
        [userId, guildId], (err, row) => {
            if (err) {
                console.error('Error fetching user stats:', err.message);
                return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error fetching your stats: ${err.message}`)], ephemeral: true });
            }
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle(`📊 ${interaction.user.tag}'s Stats`)
                .setDescription('Your activity in this server:')
                .addFields(
                    { name: 'Messages Sent', value: (row ? row.messages_sent : 0).toLocaleString(), inline: true },
                    { name: 'Voice Time', value: `${row ? row.voice_time_minutes : 0} minutes`, inline: true }
                )
                .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
                .setTimestamp();
            interaction.reply({ embeds: [embed] });
        }
    );
}
