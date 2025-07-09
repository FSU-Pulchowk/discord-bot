import { EmbedBuilder } from 'discord.js';
import { Command } from '../../utils/Command.js';

class TopVoiceCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'topvoice',
            description: 'Displays leaderboard of most active voice chat users.',
            permissions: [], 
            usage: '[limit (1-20)]',
            aliases: ['topvc', 'voiceleaders'],
            dbInstance: options.dbInstance,
        });
    }

    async execute(message, args) {
        const limit = parseInt(args[0]) || 10;
        if (isNaN(limit) || limit <= 0 || limit > 20) {
            return this.sendUsage(message, 'The limit must be a number between 1 and 20.');
        }

        this.db.all(`SELECT user_id, voice_time_minutes FROM user_stats WHERE guild_id = ? ORDER BY voice_time_minutes DESC LIMIT ?`,
            [message.guild.id, limit],
            async (err, rows) => {
                if (err) {
                    console.error('Error fetching top voice users:', err.message);
                    return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ Error fetching the top voice chatters leaderboard.')] });
                }

                const embed = new EmbedBuilder()
                    .setColor('#40E0D0') // Turquoise
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
                            const user = await this.client.users.fetch(rows[i].user_id);
                            description += `**${i + 1}. ${user.tag}**: ${timeString}\n`;
                        } catch (fetchErr) {
                            console.warn(`Could not fetch user ${rows[i].user_id} for top voice:`, fetchErr.message);
                            description += `**${i + 1}. Unknown User (ID: ${rows[i].user_id})**: ${timeString}\n`;
                        }
                    }
                    embed.setDescription(description);
                }
                message.reply({ embeds: [embed] });
            }
        );
    }
}

export { TopVoiceCommand };