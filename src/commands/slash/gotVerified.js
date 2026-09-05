import {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionsBitField,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} from 'discord.js';

const MAX_USERS_PER_PAGE = 10;

export const data = new SlashCommandBuilder()
    .setName('gotverified')
    .setDescription('Displays a list of verified users with their real names and college email addresses.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild);

/**
 * Generates the paginated verified users embed & buttons
 */
export async function renderGotVerifiedPage(interaction, allRows, page, originalUserId) {
    const totalPages = Math.max(1, Math.ceil(allRows.length / MAX_USERS_PER_PAGE));

    const start = page * MAX_USERS_PER_PAGE;
    const end = start + MAX_USERS_PER_PAGE;
    const paginatedRows = allRows.slice(start, end);

    const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle(`✅ Verified Users in ${interaction.guild.name}`)
        .setTimestamp()
        .setFooter({
            text: `Page ${page + 1} of ${totalPages} | Total Verified Users: ${allRows.length}`
        });

    const userPromises = paginatedRows.map(async (row) => {
        let userTag = `ID: ${row.user_id}`;
        try {
            const user = interaction.client.users.cache.get(row.user_id) ||
                await interaction.client.users.fetch(row.user_id).catch(() => null);
            if (user) {
                userTag = user.tag;
            }
        } catch {
            // Ignore fetch errors
        }
        return `**${row.real_name}** (${userTag}) - \`${row.email}\``;
    });

    const lines = await Promise.all(userPromises);
    const description = lines.length > 0 ? lines.join('\n') : '*No verified users on this page.*';

    embed.setDescription(description);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`gotverified_prev_${page}_${originalUserId}`)
            .setLabel('Previous')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page === 0),
        new ButtonBuilder()
            .setCustomId(`gotverified_next_${page}_${originalUserId}`)
            .setLabel('Next')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page >= totalPages - 1)
    );

    return { embeds: [embed], components: [row] };
}

/**
 * Handles gotverified pagination buttons
 */
export async function handleGotVerifiedButton(interaction) {
    const customId = interaction.customId;
    if (!customId.startsWith('gotverified_')) return;

    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate().catch(() => {});
    }

    if (!interaction.member?.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        await interaction.followUp({
            content: '⚠️ You do not have permission to view this list.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    const parts = customId.split('_');
    const action = parts[1];
    let currentPage = parseInt(parts[2], 10);
    const originalUserId = parts[3];

    if (interaction.user.id !== originalUserId) {
        await interaction.followUp({
            content: "⚠️ You cannot control someone else's verification list.",
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    const db = interaction.client.db;
    if (!db) {
        await interaction.followUp({
            content: '❌ Database connection not established.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    db.all(
        `SELECT user_id, real_name, email FROM verified_users WHERE guild_id = ? ORDER BY real_name ASC`,
        [interaction.guild.id],
        async (err, allRows) => {
            if (err) {
                console.error('Error in gotverified pagination:', err.message);
                return;
            }

            const totalPages = Math.max(1, Math.ceil((allRows || []).length / MAX_USERS_PER_PAGE));
            if (action === 'next') currentPage = Math.min(totalPages - 1, currentPage + 1);
            if (action === 'prev') currentPage = Math.max(0, currentPage - 1);

            const pageData = await renderGotVerifiedPage(interaction, allRows || [], currentPage, originalUserId);
            await interaction.editReply(pageData);
        }
    );
}

/**
 * Slash command execution
 */
export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({
            embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ This command can only be used in a server.')],
            flags: MessageFlags.Ephemeral
        });
    }

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.reply({
            content: '❌ You do not have permission to use this command.',
            flags: MessageFlags.Ephemeral
        });
    }

    if (!interaction.client.db) {
        console.error('Database connection not found on client.');
        return interaction.reply({
            embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ Database connection not established.')],
            flags: MessageFlags.Ephemeral
        });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const db = interaction.client.db;
    db.all(
        `SELECT user_id, real_name, email FROM verified_users WHERE guild_id = ? ORDER BY real_name ASC`,
        [interaction.guild.id],
        async (err, allRows) => {
            if (err) {
                console.error('Error fetching verified users:', err.message);
                return interaction.editReply({
                    embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error: ${err.message}`)]
                });
            }

            if (!allRows || allRows.length === 0) {
                return interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#0099ff')
                            .setTitle(`✅ Verified Users in ${interaction.guild.name}`)
                            .setDescription('No users have been verified in this server yet.')
                            .setTimestamp()
                    ]
                });
            }

            const firstPage = await renderGotVerifiedPage(interaction, allRows, 0, interaction.user.id);
            await interaction.editReply(firstPage);
        }
    );
}