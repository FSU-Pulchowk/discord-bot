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
    // CRITICAL: Defer reply immediately to avoid interaction timeout (3 second limit)
    let isDeferred = false;
    try {
        await interaction.deferReply({ ephemeral: true });
        isDeferred = true;
    } catch (deferError) {
        // If defer fails, interaction might be expired or already responded to
        if (deferError.code === 10062) {
            console.error('Interaction expired before deferring in clean command');
            return;
        }
        // Try to reply normally if defer fails
        try {
            await interaction.reply({
                content: '⏳ Processing your request...',
                ephemeral: true
            });
            isDeferred = false;
        } catch (replyError) {
            console.error('Failed to respond to interaction in clean command:', replyError);
            return;
        }
    }
    
    const durationInput = interaction.options.getString('duration');
    const count = interaction.options.getInteger('count');
    const targetUser = interaction.options.getUser('target_user');
    const reason = interaction.options.getString('reason') || 'No reason provided.';
    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

    const durationMs = parseDuration(durationInput);
    if (!durationMs || durationMs > 14 * 24 * 60 * 60 * 1000) {
        const errorMsg = '❌ Invalid duration. Use `s`, `m`, `h`, or `d` (up to 14 days). Example: `30m`, `2h`';
        return interaction.editReply({ content: errorMsg }).catch(() => {
            interaction.followUp({ content: errorMsg, ephemeral: true }).catch(() => {});
        });
    }

    const now = Date.now();
    const threshold = now - durationMs;

    try {

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
        try {
            await interaction.editReply({
                content: '❌ Failed to clean messages. Check my permissions.',
            });
        } catch (editErr) {
            // If edit fails, try followUp as fallback
            if (err.code !== 10062) { // Don't log if interaction already expired
                console.error('Error editing reply:', editErr);
            }
            try {
                await interaction.followUp({
                    content: '❌ Failed to clean messages. Check my permissions.',
                    ephemeral: true
                });
            } catch (followUpErr) {
                // Interaction might be completely expired
                console.error('Error sending followUp:', followUpErr);
            }
        }
    }
}