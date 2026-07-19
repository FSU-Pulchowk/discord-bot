import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('task')
    .setDescription('Manages administrative tasks for the server.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
    .addSubcommand(subcommand =>
        subcommand
            .setName('add')
            .setDescription('Adds a new administrative task to the to-do list.')
            .addStringOption(option =>
                option.setName('description')
                    .setDescription('The description of the task')
                    .setRequired(true)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('complete')
            .setDescription('Marks an administrative task as completed.')
            .addIntegerOption(option =>
                option.setName('task_id')
                    .setDescription('The ID of the task to mark as completed')
                    .setRequired(true)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('list')
            .setDescription('Lists admin tasks, filterable by status.')
            .addStringOption(option =>
                option.setName('status')
                    .setDescription('Filter tasks by status')
                    .setRequired(false)
                    .addChoices(
                        { name: 'Pending', value: 'pending' },
                        { name: 'Completed', value: 'completed' },
                        { name: 'In-Progress', value: 'in-progress' },
                        { name: 'All', value: 'all' }
                    )));

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const subcommand = interaction.options.getSubcommand();
    const db = interaction.client.db;

    switch (subcommand) {
        case 'add': {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
                return interaction.editReply({ content: 'You do not have permission to use this command.' });
            }

            const taskDescription = interaction.options.getString('description');
            const userId = interaction.user.id;
            const guildId = interaction.guild.id;

            db.run(`INSERT INTO admin_tasks (guild_id, creatorId, taskDescription, createdAt, status) VALUES (?, ?, ?, ?, ?)`,
                [guildId, userId, taskDescription, Date.now(), 'pending'],
                function(err) {
                    if (err) {
                        console.error('Error inserting task:', err.message);
                        const embed = new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error adding task: ${err.message}`);
                        return interaction.editReply({ embeds: [embed] });
                    }
                    const embed = new EmbedBuilder().setColor('#00FF00').setTitle('✅ Task Added').setDescription(`Task **#${this.lastID}**: \`${taskDescription}\``)
                        .addFields(
                            { name: 'Created By', value: interaction.user.tag, inline: true },
                            { name: 'Status', value: 'Pending', inline: true }
                        ).setTimestamp();
                    interaction.editReply({ embeds: [embed] });
                }
            );
            break;
        }

        case 'complete': {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                return interaction.editReply({ content: 'You do not have permission to use this command.' });
            }

            const taskId = interaction.options.getInteger('task_id');
            const userId = interaction.user.id;
            const guildId = interaction.guild.id;

            db.get(`SELECT * FROM admin_tasks WHERE id = ? AND guild_id = ?`, [taskId, guildId], async (err, row) => {
                if (err) {
                    console.error('Error fetching task:', err.message);
                    return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error checking task: ${err.message}`)] });
                }
                if (!row) return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`❌ Task ID **#${taskId}** not found.`)] });
                if (row.status === 'completed') return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`⚠️ Task **#${taskId}** is already completed.`)] });

                db.run(`UPDATE admin_tasks SET status = 'completed', completedAt = ?, completedBy = ? WHERE id = ?`,
                    [Date.now(), userId, taskId],
                    (updateErr) => {
                        if (updateErr) {
                            console.error('Error updating task:', updateErr.message);
                            return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error completing task: ${updateErr.message}`)] });
                        }
                        const embed = new EmbedBuilder().setColor('#00FF00').setTitle('✅ Task Completed').setDescription(`Task **#${taskId}**: \`${row.taskDescription}\` marked completed by ${interaction.user.tag}.`).setTimestamp();
                        interaction.editReply({ embeds: [embed] });
                    }
                );
            });
            break;
        }

        case 'list': {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
                return interaction.editReply({ content: 'You do not have permission to use this command.' });
            }

            let statusFilter = interaction.options.getString('status') || 'pending';
            let queryStatus = statusFilter;
            if (statusFilter === 'all') {
                queryStatus = '%';
            } else if (!['pending', 'completed', 'in-progress'].includes(statusFilter)) {
                return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ Invalid status. Use `pending`, `completed`, `in-progress`, or `all`.")] });
            }

            const query = `SELECT * FROM admin_tasks WHERE guild_id = ? AND status LIKE ? ORDER BY createdAt DESC`;
            db.all(query, [interaction.guild.id, queryStatus], async (err, rows) => {
                if (err) {
                    console.error('Error fetching tasks:', err.message);
                    return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error fetching tasks: ${err.message}`)] });
                }

                const embedTitle = `📋 Admin Tasks (${statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)})`;
                const embed = new EmbedBuilder().setColor('#0099ff').setTitle(embedTitle).setTimestamp();

                if (rows.length === 0) {
                    embed.setDescription(`No ${statusFilter} tasks found for this server.`);
                } else {
                    const taskDescriptions = [];
                    let currentLength = 0;
                    const MAX_DESCRIPTION_LENGTH = 3800;

                    for (const row of rows) {
                        let creatorTag = `ID: ${row.creatorId}`;
                        try {
                            const user = await interaction.client.users.fetch(row.creatorId);
                            creatorTag = user.tag;
                        } catch (fetchErr) {
                            console.warn(`Could not fetch creator user ${row.creatorId}:`, fetchErr.message);
                        }

                        let assigneeTag = '';
                        if (row.assigned_to) {
                            try {
                                const user = await interaction.client.users.fetch(row.assigned_to);
                                assigneeTag = ` | Assigned: ${user.tag}`;
                            } catch (fetchErr) {
                                console.warn(`Could not fetch assignee user ${row.assigned_to}:`, fetchErr.message);
                            }
                        }

                        let completedByTag = '';
                        if (row.completedBy) {
                            try {
                                const user = await interaction.client.users.fetch(row.completedBy);
                                completedByTag = ` by ${user.tag}`;
                            } catch (fetchErr) {
                                console.warn(`Could not fetch completedBy user ${row.completedBy}:`, fetchErr.message);
                            }
                        }

                        const taskLine = `**#${row.id}**: ${row.taskDescription}\n` +
                                         `> Status: \`${row.status.toUpperCase()}\` | Created: ${creatorTag} on ${new Date(row.createdAt).toLocaleDateString()}${assigneeTag}` +
                                         `${row.status === 'completed' && row.completedAt ? ` | Completed${completedByTag} on ${new Date(row.completedAt).toLocaleDateString()}` : ''}`;

                        if (currentLength + taskLine.length + 2 > MAX_DESCRIPTION_LENGTH) {
                             embed.setFooter({text: `Displaying a subset of ${rows.length} tasks due to length. Refine your filter for more.`});
                             break;
                        }
                        taskDescriptions.push(taskLine);
                        currentLength += taskLine.length + 2;
                    }
                    embed.setDescription(taskDescriptions.join('\n\n'));
                }
                interaction.editReply({ embeds: [embed] });
            });
            break;
        }
    }
}