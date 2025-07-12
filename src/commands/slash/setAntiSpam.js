import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('setantispam')
    .setDescription('Configures anti-spam settings.')
    .addIntegerOption(option =>
        option.setName('message_limit')
            .setDescription('Max messages allowed in time window (e.g., 5)')
            .setRequired(false))
    .addIntegerOption(option =>
        option.setName('time_window_seconds')
            .setDescription('Time window in seconds (e.g., 5)')
            .setRequired(false))
    .addIntegerOption(option =>
        option.setName('mute_duration_seconds')
            .setDescription('Duration of mute in seconds (e.g., 300)')
            .setRequired(false))
    .addIntegerOption(option =>
        option.setName('kick_threshold')
            .setDescription('Warnings before kick (e.g., 3)')
            .setRequired(false))
    .addIntegerOption(option =>
        option.setName('ban_threshold')
            .setDescription('Warnings before ban (e.g., 5)')
            .setRequired(false))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator);

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    const settingsToUpdate = {};
    const options = interaction.options;

    // Dynamically get options and add to settingsToUpdate
    if (options.getInteger('message_limit') !== null) settingsToUpdate.message_limit = options.getInteger('message_limit');
    if (options.getInteger('time_window_seconds') !== null) settingsToUpdate.time_window_seconds = options.getInteger('time_window_seconds');
    if (options.getInteger('mute_duration_seconds') !== null) settingsToUpdate.mute_duration_seconds = options.getInteger('mute_duration_seconds');
    if (options.getInteger('kick_threshold') !== null) settingsToUpdate.kick_threshold = options.getInteger('kick_threshold');
    if (options.getInteger('ban_threshold') !== null) settingsToUpdate.ban_threshold = options.getInteger('ban_threshold');

    if (Object.keys(settingsToUpdate).length === 0) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`❌ No settings provided for update. Please provide at least one setting to change.`)], ephemeral: true });
    }

    const guildId = interaction.guild.id;
    const db = interaction.client.db;

    db.get(`SELECT * FROM anti_spam_configs WHERE guild_id = ?`, [guildId], (err, row) => {
        if (err) {
            console.error('Error fetching anti-spam config:', err.message);
            return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error fetching current anti-spam settings: ${err.message}`)], ephemeral: true });
        }

        const currentSettings = row || {
            guild_id: guildId,
            message_limit: 5,
            time_window_seconds: 5,
            mute_duration_seconds: 300,
            kick_threshold: 3,
            ban_threshold: 5
        };
        const newSettings = { ...currentSettings, ...settingsToUpdate };

        db.run(`INSERT OR REPLACE INTO anti_spam_configs (guild_id, message_limit, time_window_seconds, mute_duration_seconds, kick_threshold, ban_threshold) VALUES (?, ?, ?, ?, ?, ?)`,
            [newSettings.guild_id, newSettings.message_limit, newSettings.time_window_seconds, newSettings.mute_duration_seconds, newSettings.kick_threshold, newSettings.ban_threshold],
            (runErr) => {
                if (runErr) {
                    console.error('Error saving anti-spam config:', runErr.message);
                    return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error saving anti-spam settings: ${runErr.message}`)], ephemeral: true });
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
                interaction.reply({ embeds: [embed] });
            }
        );
    });
}