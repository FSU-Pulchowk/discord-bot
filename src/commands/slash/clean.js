import {
    SlashCommandBuilder,
    PermissionsBitField,
    EmbedBuilder,
    ChannelType,
} from 'discord.js';

function parseDuration(duration) {
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) return null;
    const [_, num, unit] = match;
    const multiplier = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit];
    return parseInt(num) * multiplier;
}

export const data = new SlashCommandBuilder()
    .setName('clean')
    .setDescription('Deletes messages within a specific time frame from a channel.')
    .addStringOption(option =>
        option.setName('duration')
        .setDescription('Duration like 10m, 1h, 2d (up to 14d)')
        .setRequired(true))
    .addIntegerOption(option =>
        option.setName('count')
        .setDescription('Number of messages to delete (up to 100)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(100))
    .addUserOption(option =>
        option.setName('target_user')
        .setDescription('Only delete messages from a specific user')
        .setRequired(false)) 
    .addStringOption(option =>
        option.setName('reason')
        .setDescription('Reason for message deletion')
        .setRequired(false))
    .addChannelOption(option =>
        option.setName('channel')
        .setDescription('Channel to clean (default is current)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)) 
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild);

export async function execute(interaction) {
    const durationInput = interaction.options.getString('duration');
    const count = interaction.options.getInteger('count');
    const targetUser = interaction.options.getUser('target_user');
    const reason = interaction.options.getString('reason') || 'No reason provided.';
    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

    const durationMs = parseDuration(durationInput);
    if (!durationMs || durationMs > 14 * 24 * 60 * 60 * 1000) {
        return interaction.reply({
            content: '❌ Invalid duration. Use `s`, `m`, `h`, or `d` (up to 14 days). Example: `30m`, `2h`',
            ephemeral: true
        });
    }

    const now = Date.now();
    const threshold = now - durationMs;

    try {
        await interaction.deferReply({ ephemeral: true });

        const messages = await targetChannel.messages.fetch({ limit: 100 });
        let toDelete = messages.filter(msg =>
            msg.createdTimestamp >= threshold &&
            msg.deletable
        );

        if (targetUser) {
            toDelete = toDelete.filter(msg => msg.author.id === targetUser.id);
        }

        if (count) {
            toDelete = toDelete.first(count);
        }

        const deleteResults = [];
        for (const msg of toDelete.values()) {
            deleteResults.push(msg.delete().catch(() => null));
        }
        const results = await Promise.all(deleteResults);
        const deletedCount = results.filter(Boolean).length;

        const embed = new EmbedBuilder()
            .setColor('#00ffff')
            .setTitle('🧹 Clean Complete')
            .addFields(
                { name: '🕒 Duration', value: durationInput, inline: true },
                { name: '📄 Reason', value: reason, inline: true },
                { name: '📺 Channel', value: `${targetChannel}`, inline: true },
                { name: '🧮 Deleted', value: `${deletedCount} messages`, inline: true }
            );

        if (targetUser) {
            embed.addFields({ name: '👤 Targeted User', value: `${targetUser}`, inline: true });
        }
        if (count) {
            embed.addFields({ name: '🔢 Messages to Target', value: `${count}`, inline: true });
        }

        embed.setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    } catch (err) {
        console.error('Error during clean:', err);
        await interaction.editReply({
            content: '❌ Failed to clean messages. Check my permissions.',
        });
    }
}