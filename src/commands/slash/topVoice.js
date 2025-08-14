import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('topvoice')
    .setDescription('Displays leaderboard of most active voice chat users.')
    .addIntegerOption(option =>
        option.setName('limit')
            .setDescription('Number of users to display (1-20, defaults to 10)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(20))
    .setDMPermission(false);

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    const limit = interaction.options.getInteger('limit') || 10;
    const guildId = interaction.guild.id;
    const db = interaction.client.db;

    await interaction.deferReply(); // Defer reply as DB query can take time

    db.all(`SELECT user_id, voice_time_minutes FROM user_stats WHERE guild_id = ? ORDER BY voice_time_minutes DESC LIMIT ?`,
        [guildId, limit],
        async (err, rows) => {
            if (err) {
                console.error('Error fetching top voice users:', err.message);
                return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ Error fetching the top voice chatters leaderboard.')] });
            }

            const embed = new EmbedBuilder()
                .setColor('#40E0D0')
                .setTitle('🎙️ Top Voice Chatters')
                .setTimestamp();

            if (rows.length === 0) {
                embed.setDescription('No voice chat data recorded yet for this server. Join a voice channel to appear on the leaderboard!');
            } else {
                let description = `Top ${rows.length} users by voice chat time:\n\n`;
                for (let i = 0; i < rows.length; i++) {
                    const minutesTotal = rows[i].voice_time_minutes;
                    const hours = Math.floor(minutesTotal / 60);
                    const minutes = minutesTotal % 60;
                    const timeString = `${hours > 0 ? `${hours}h ` : ''}${minutes}m`;

                    try {
                        const user = interaction.client.users.cache.get(rows[i].user_id) || await interaction.client.users.fetch(rows[i].user_id);
                        description += `**${i + 1}. ${user.tag}**: ${timeString}\n`;
                    } catch (fetchErr) {
                        console.warn(`Could not fetch user ${rows[i].user_id} for top voice:`, fetchErr.message);
                        description += `**${i + 1}. Unknown User (ID: ${rows[i].user_id})**: ${timeString}\n`;
                    }
                }
                embed.setDescription(description);
            }
            interaction.editReply({ embeds: [embed] });
        }
    );
}
