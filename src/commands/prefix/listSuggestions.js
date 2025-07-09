import { EmbedBuilder, PermissionsBitField, ChannelType } from 'discord.js';
import { Command } from '../../utils/Command.js';
import dotenv from 'dotenv';

dotenv.config();

class ListSuggestionsCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'listsuggestions',
            description: 'Lists suggestions, filterable by status.',
            permissions: [PermissionsBitField.Flags.Administrator, PermissionsBitField.Flags.ManageGuild],
            usage: '[status (pending|approved|denied|implemented|all)]',
            aliases: ['lsuggestions', 'viewsuggestions'],
            dbInstance: options.dbInstance,
        });
        this.SUGGESTIONS_CHANNEL_ID = process.env.SUGGESTIONS_CHANNEL_ID || 'YOUR_SUGGESTIONS_CHANNEL_ID_HERE';
    }

    async execute(message, args) {
        let statusFilter = args[0] ? args[0].toLowerCase() : 'pending';
        let queryStatus = statusFilter; 
        if (statusFilter === 'all') {
            queryStatus = '%'; 
        } else if (!['pending', 'approved', 'denied', 'implemented'].includes(statusFilter)) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ Invalid status. Use `pending`, `approved`, `denied`, `implemented`, or `all`.")] });
        }

        const query = `SELECT * FROM suggestions WHERE guild_id = ? AND status LIKE ? ORDER BY created_at DESC`;
        this.db.all(query, [message.guild.id, queryStatus], async (err, rows) => {
            if (err) {
                console.error('Error fetching suggestions:', err.message);
                return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error fetching suggestions: ${err.message}`)] });
            }

            const embedTitle = `💡 Suggestions (${statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)})`;
            const embed = new EmbedBuilder().setColor('#0099ff').setTitle(embedTitle).setTimestamp();
            
            if (rows.length === 0) {
                embed.setDescription(`No ${statusFilter} suggestions found for this server.`);
            } else {
                const suggestionFields = [];
                for (const row of rows) {
                    if (suggestionFields.length >= 25) {
                        embed.setFooter({text: `Displaying first 25 of ${rows.length} suggestions. For more, refine your search.`});
                        break;
                    }

                    let suggesterTag = `ID: ${row.user_id}`;
                    try {
                        const user = await this.client.users.fetch(row.user_id);
                        suggesterTag = user.tag;
                    } catch (fetchErr) {
                        console.warn(`Could not fetch suggester user ${row.user_id}:`, fetchErr.message);
                    }
                    
                    let reviewedByTag = '';
                    if(row.reviewed_by) {
                        try {
                            const reviewer = await this.client.users.fetch(row.reviewed_by);
                            reviewedByTag = ` by ${reviewer.tag}`;
                        } catch (fetchErr) {
                            console.warn(`Could not fetch reviewer user ${row.reviewed_by}:`, fetchErr.message);
                        }
                    }

                    let fieldText = `"${row.suggestion_text}"\n` +
                                   `> Suggested by: ${suggesterTag} on ${new Date(row.created_at).toLocaleDateString()}\n` +
                                   `> Votes: 👍 ${row.upvotes || 0} / 👎 ${row.downvotes || 0}`;
                    
                    if (row.reviewed_at) {
                        fieldText += `\n> Reviewed${reviewedByTag} on ${new Date(row.reviewed_at).toLocaleDateString()}`;
                    }
                    if (row.reason && (row.status === 'approved' || row.status === 'denied')) {
                        fieldText += `\n> Reason: ${row.reason}`;
                    }
                    if (row.message_id && this.SUGGESTIONS_CHANNEL_ID !== process.env.SUGGESTIONS_CHANNEL_ID) {
                        fieldText += `\n> [View Original Suggestion](https://discord.com/channels/${message.guild.id}/${this.SUGGESTIONS_CHANNEL_ID}/${row.message_id})`;
                    }

                    suggestionFields.push({
                        name: `Suggestion #${row.id} (Status: ${row.status.toUpperCase()})`,
                        value: fieldText.substring(0, 1020)
                    });
                }
                embed.addFields(suggestionFields);
            }
            message.reply({ embeds: [embed] });
        });
    }
}

export { ListSuggestionsCommand };