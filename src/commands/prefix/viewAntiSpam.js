import { EmbedBuilder, PermissionsBitField } from 'discord.js';
import { Command } from '../../utils/Command.js';

class ViewAntiSpamCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'viewantispam',
            description: 'Displays current anti-spam settings.',
            permissions: [PermissionsBitField.Flags.Administrator],
            usage: '',
            aliases: ['showantispam', 'getantispam'],
            dbInstance: options.dbInstance,
        });
    }

    async execute(message, args) {
        this.db.get(`SELECT * FROM anti_spam_configs WHERE guild_id = ?`, [message.guild.id], (err, row) => {
            if (err) {
                console.error('Error fetching anti-spam config:', err.message);
                return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error fetching anti-spam settings: ${err.message}`)] });
            }

            const settings = row || {
                message_limit: 5,
                time_window_seconds: 5,
                mute_duration_seconds: 300,
                kick_threshold: 3,
                ban_threshold: 5
            };

            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('🛡️ Current Anti-Spam Settings')
                .addFields(
                    Object.entries(settings)
                        .filter(([key]) => key !== 'guild_id')
                        .map(([key, value]) => ({
                            name: key.split('_').map(s => s.charAt(0).toUpperCase() + s.substring(1)).join(' '),
                            value: value.toString(),
                            inline: true
                        }))
                )
                .setFooter({ text: `Configure with ${this.client.PREFIX}setantispam` })
                .setTimestamp();
            
            message.reply({ embeds: [embed] });
        });
    }
}

export { ViewAntiSpamCommand };