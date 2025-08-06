import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('gotverified')
    .setDescription('Displays a list of verified users with their real names and college email addresses.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild);

export const MAX_USERS_PER_PAGE = 10;

// This function will be called by the central handler in bot.js
export const generateEmbedAndButtons = async (interaction, page, allRows) => {
    const totalPages = Math.ceil(allRows.length / MAX_USERS_PER_PAGE);
    const start = page * MAX_USERS_PER_PAGE;
    const end = start + MAX_USERS_PER_PAGE;
    const paginatedRows = allRows.slice(start, end);

    const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle(`✅ Verified Users in ${interaction.guild.name}`)
        .setTimestamp()
        .setFooter({ text: `Page ${page + 1} of ${totalPages} | Total Verified Users: ${allRows.length}` });

    let description = '';
    for (const row of paginatedRows) {
        let userTag = `ID: ${row.user_id}`;
        try {
            const user = interaction.client.users.cache.get(row.user_id) || await interaction.client.users.fetch(row.user_id).catch(() => null);
            if (user) {
                userTag = user.tag;
            }
        } catch (fetchErr) {
            console.warn(`Could not fetch Discord user for ID ${row.user_id}:`, fetchErr.message);
        }
        description += `**${row.real_name}** (${userTag}) - \`${row.email}\`\n`;
    }
    embed.setDescription(description || 'No users on this page.');

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`gotverified_prev_${page}`)
            .setLabel('Previous')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page === 0),
        new ButtonBuilder()
            .setCustomId(`gotverified_next_${page}`)
            .setLabel('Next')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page >= totalPages - 1)
    );

    return { embeds: [embed], components: [buttons], ephemeral: true };
};

export async function execute(interaction) {
    if (!interaction.guild || !interaction.client.db) {
        return interaction.reply({ content: '❌ This command cannot be run or the database is not available.', ephemeral: true });
    }

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    
    const db = interaction.client.db;
    db.all(`SELECT user_id, real_name, email FROM verified_users WHERE guild_id = ? ORDER BY real_name ASC`,
        [interaction.guild.id],
        async (err, allRows) => {
            if (err) {
                console.error('Error fetching verified users:', err.message);
                return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error fetching verified users: ${err.message}`)] });
            }

            if (allRows.length === 0) {
                const embed = new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle(`✅ Verified Users in ${interaction.guild.name}`)
                    .setDescription('No users have been verified in this server yet.')
                    .setTimestamp();
                return interaction.editReply({ embeds: [embed] });
            }
            
            const messagePayload = await generateEmbedAndButtons(interaction, 0, allRows);
            await interaction.editReply(messagePayload);
        }
    );
}