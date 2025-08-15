import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('viewantispam')
    .setDescription('Displays current anti-spam settings.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator);

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    const guildId = interaction.guild.id;
    const db = interaction.client.db;

    db.get(`SELECT * FROM anti_spam_configs WHERE guild_id = ?`, [guildId], (err, row) => {
        if (err) {
            console.error('Error fetching anti-spam config:', err.message);
            return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error fetching anti-spam settings: ${err.message}`)], ephemeral: true });
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
            .setFooter({ text: `Configure with /setantispam` })
            .setTimestamp();
        
        interaction.reply({ embeds: [embed] }); // Can be ephemeral or public
    });
}
