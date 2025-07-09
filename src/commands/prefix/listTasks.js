import { EmbedBuilder, PermissionsBitField } from 'discord.js';
import { Command } from '../../utils/Command.js';

class ListTasksCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'listtasks',
            description: 'Lists admin tasks, filterable by status.',
            permissions: [PermissionsBitField.Flags.Administrator],
            usage: '[status (pending|completed|in-progress|all)]',
            aliases: ['ltasks', 'viewtasks'],
            dbInstance: options.dbInstance,
        });
    }

    async execute(message, args) {
        let statusFilter = args[0] ? args[0].toLowerCase() : 'pending';
        let queryStatus = statusFilter;
        if (statusFilter === 'all') {
            queryStatus = '%'; // Wildcard for 'all' statuses
        } else if (!['pending', 'completed', 'in-progress'].includes(statusFilter)) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ Invalid status. Use `pending`, `completed`, `in-progress`, or `all`.")] });
        }

        const query = `SELECT * FROM admin_tasks WHERE guildId = ? AND status LIKE ? ORDER BY createdAt DESC`;
        this.db.all(query, [message.guild.id, queryStatus], async (err, rows) => {
            if (err) {
                console.error('Error fetching tasks:', err.message);
                return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error fetching tasks: ${err.message}`)] });
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
                        const user = await this.client.users.fetch(row.creatorId);
                        creatorTag = user.tag;
                    } catch (fetchErr) {
                        console.warn(`Could not fetch creator user ${row.creatorId}:`, fetchErr.message);
                    }

                    let assigneeTag = '';
                    if(row.assigneeId) {
                        try {
                            const user = await this.client.users.fetch(row.assigneeId);
                            assigneeTag = ` | Assigned: ${user.tag}`;
                        } catch (fetchErr) {
                            console.warn(`Could not fetch assignee user ${row.assigneeId}:`, fetchErr.message);
                        }
                    }

                    let completedByTag = '';
                    if(row.completedBy) {
                        try {
                            const user = await this.client.users.fetch(row.completedBy);
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
            message.reply({ embeds: [embed] });
        });
    }
}

export { ListTasksCommand };