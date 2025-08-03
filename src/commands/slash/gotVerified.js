import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('gotverified')
    .setDescription('Displays a list of verified users with their real names and college email addresses.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild); 

const MAX_USERS_PER_PAGE = 10; 

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ This command can only be used in a server.')], ephemeral: true });
    }

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    if (!interaction.client.db) {
        console.error('Database connection not found on client. Please ensure it is initialized.');
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ Database connection not established. Please contact an administrator.')], ephemeral: true });
    }

    const db = interaction.client.db;
    let currentPage = 0; 
    await interaction.deferReply({ ephemeral: true });

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

            const totalPages = Math.ceil(allRows.length / MAX_USERS_PER_PAGE);

            const generateEmbed = async (page) => {
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
                embed.setDescription(description);
                return embed;
            };

            const generateButtons = (page) => {
                return new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`gotverified_prev_${page}`)
                        .setLabel('Previous')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(page === 0), 
                    new ButtonBuilder()
                        .setCustomId(`gotverified_next_${page}`)
                        .setLabel('Next')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(page === totalPages - 1) 
                );
            };

            await interaction.editReply({
                embeds: [await generateEmbed(currentPage)],
                components: [generateButtons(currentPage)]
            });

            const collector = interaction.channel.createMessageComponentCollector({
                filter: i => i.customId.startsWith('gotverified_') && i.user.id === interaction.user.id,
                time: 60 * 1000 
            });

            collector.on('collect', async i => {
                const parts = i.customId.split('_');
                const action = parts[1];
                const oldPageFromCustomId = parseInt(parts[2]);
                if (action === 'next') {
                    currentPage = Math.min(oldPageFromCustomId + 1, totalPages - 1);
                } else if (action === 'prev') {
                    currentPage = Math.max(oldPageFromCustomId - 1, 0);
                }
                await i.update({
                    embeds: [await generateEmbed(currentPage)],
                    components: [generateButtons(currentPage)]
                }).catch(updateErr => console.error('Error updating interaction reply:', updateErr));
            });

            collector.on('end', async collected => {
                if (interaction.replied || interaction.deferred) {
                    const message = await interaction.fetchReply().catch(() => null);
                    if (message && message.components.length > 0) {
                        const disabledRow = ActionRowBuilder.from(message.components[0]);
                        disabledRow.components.forEach(button => button.setDisabled(true));
                        await interaction.editReply({ components: [disabledRow] }).catch(console.error);
                    }
                }
            });
        }
    );
}
