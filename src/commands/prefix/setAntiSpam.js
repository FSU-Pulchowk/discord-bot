import { EmbedBuilder, PermissionsBitField } from 'discord.js';
import { Command } from '../../utils/Command.js';

class SetAntiSpamCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'setantispam',
            description: 'Configures anti-spam settings.',
            permissions: [PermissionsBitField.Flags.Administrator], // Only administrators can configure anti-spam
            usage: '[setting <value>] ... (e.g., message_limit 7 time_window_seconds 10)',
            dbInstance: options.dbInstance,
        });
    }

    async execute(message, args) {
        if (args.length === 0 || args.length % 2 !== 0) {
            return this.sendUsage(message, `Example: \`${this.client.PREFIX}setantispam message_limit 7 time_window_seconds 10 mute_duration_seconds 600\`` +
                                      `\nValid settings: \`message_limit\`, \`time_window_seconds\`, \`mute_duration_seconds\`, \`kick_threshold\`, \`ban_threshold\`.`);
        }

        const settingsToUpdate = {};
        const validKeys = ['message_limit', 'time_window_seconds', 'mute_duration_seconds', 'kick_threshold', 'ban_threshold'];
        
        for (let i = 0; i < args.length; i += 2) {
            const key = args[i].toLowerCase();
            const value = parseInt(args[i + 1]);

            if (!validKeys.includes(key)) {
                return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`❌ Invalid setting: \`${args[i]}\`. Please use one of: ${validKeys.join(', ')}.`)] });
            }
            if (isNaN(value) || value < 0) {
                return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`❌ Invalid value for \`${key}\`. Must be a non-negative number.`)] });
            }
            settingsToUpdate[key] = value;
        }

        if (Object.keys(settingsToUpdate).length === 0) {
            return this.sendUsage(message, "No valid settings provided for update.");
        }

        this.db.get(`SELECT * FROM anti_spam_configs WHERE guild_id = ?`, [message.guild.id], (err, row) => {
            if (err) {
                console.error('Error fetching anti-spam config:', err.message);
                return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error fetching current anti-spam settings: ${err.message}`)] });
            }

            const currentSettings = row || {
                guild_id: message.guild.id,
                message_limit: 5,
                time_window_seconds: 5,
                mute_duration_seconds: 300,
                kick_threshold: 3,
                ban_threshold: 5
            };
            const newSettings = { ...currentSettings, ...settingsToUpdate };

            this.db.run(`INSERT OR REPLACE INTO anti_spam_configs (guild_id, message_limit, time_window_seconds, mute_duration_seconds, kick_threshold, ban_threshold) VALUES (?, ?, ?, ?, ?, ?)`,
                [newSettings.guild_id, newSettings.message_limit, newSettings.time_window_seconds, newSettings.mute_duration_seconds, newSettings.kick_threshold, newSettings.ban_threshold],
                (runErr) => {
                    if (runErr) {
                        console.error('Error saving anti-spam config:', runErr.message);
                        return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error saving anti-spam settings: ${runErr.message}`)] });
                    }

                    const embed = new EmbedBuilder()
                        .setColor('#00FF00')
                        .setTitle('✅ Anti-Spam Settings Updated')
                        .addFields(
                            Object.entries(newSettings)
                                .filter(([key]) => key !== 'guild_id')
                                .map(([key, value]) => ({
                                    name: key.split('_').map(s => s.charAt(0).toUpperCase() + s.substring(1)).join(' '),
                                    value: value.toString(),
                                    inline: true
                                }))
                        )
                        .setTimestamp();
                    message.reply({ embeds: [embed] });
                }
            );
        });
    }
}

export { SetAntiSpamCommand };