import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('listtasks')
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
            ))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.KickMembers); 

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
        return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    let statusFilter = interaction.options.getString('status') || 'pending';
    let queryStatus = statusFilter;
    if (statusFilter === 'all') {
        queryStatus = '%';
    } else if (!['pending', 'completed', 'in-progress'].includes(statusFilter)) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ Invalid status. Use `pending`, `completed`, `in-progress`, or `all`.")], ephemeral: true });
    }

    const db = interaction.client.db;

    const query = `SELECT * FROM admin_tasks WHERE guildId = ? AND status LIKE ? ORDER BY createdAt DESC`;
    db.all(query, [interaction.guild.id, queryStatus], async (err, rows) => {
        if (err) {
            console.error('Error fetching tasks:', err.message);
            return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error fetching tasks: ${err.message}`)], ephemeral: true });
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
                if(row.assigneeId) {
                    try {
                        const user = await interaction.client.users.fetch(row.assigneeId);
                        assigneeTag = ` | Assigned: ${user.tag}`;
                    } catch (fetchErr) {
                        console.warn(`Could not fetch assignee user ${row.assigneeId}:`, fetchErr.message);
                    }
                }

                let completedByTag = '';
                if(row.completedBy) {
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
        interaction.reply({ embeds: [embed] });
    });
}
