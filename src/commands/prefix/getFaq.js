import { EmbedBuilder } from 'discord.js';
import { Command } from '../../utils/Command.js';

class GetFaqCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'getfaq',
            description: 'Retrieves an FAQ by ID or searches by keywords.',
            permissions: [], 
            usage: '<FAQ ID | keywords>',
            dbInstance: options.dbInstance,
        });
    }

    async execute(message, args) {
        if (args.length === 0) return this.sendUsage(message, `Example: \`${this.client.PREFIX}getfaq 123\` or \`${this.client.PREFIX}getfaq FSU admission\``);
        
        const queryInput = args.join(' ').toLowerCase();
        const faqId = parseInt(queryInput);
        let sqlQuery, params;

        if (!isNaN(faqId)) {
            sqlQuery = `SELECT * FROM faqs WHERE id = ? AND guild_id = ?`;
            params = [faqId, message.guild.id];
        } else {
            const searchKeywords = `%${queryInput}%`;
            sqlQuery = `SELECT * FROM faqs WHERE guild_id = ? AND (LOWER(question) LIKE ? OR LOWER(answer) LIKE ? OR (keywords IS NOT NULL AND LOWER(keywords) LIKE ?)) ORDER BY id DESC LIMIT 5`;
            params = [message.guild.id, searchKeywords, searchKeywords, searchKeywords];
        }

        this.db.all(sqlQuery, params, async (err, rows) => {
            if (err) {
                console.error('Error fetching FAQ:', err.message);
                return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error fetching FAQ: ${err.message}`)] });
            }
            if (rows.length === 0) {
                return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`❌ No FAQ found for "${queryInput}".`)] });
            }

            const embeds = [];
            for (const row of rows) {
                let creatorTag = 'Unknown User';
                if (row.created_by) {
                    try {
                        const creator = await this.client.users.fetch(row.created_by);
                        creatorTag = creator.tag;
                    } catch (fetchError) {
                        console.warn(`Could not fetch user ${row.created_by} for FAQ ID ${row.id}:`, fetchError.message);
                    }
                }
                embeds.push(new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle(`❓ FAQ ID #${row.id}: ${row.question}`)
                    .setDescription(row.answer)
                    .addFields(
                        { name: 'Keywords', value: row.keywords || 'None', inline: true },
                        { name: 'Added By', value: creatorTag, inline: true }
                    )
                    .setTimestamp(new Date(row.created_at || Date.now()))); // Use created_at if available, else current time
            }
            // Send up to 5 FAQs to avoid spamming
            message.reply({ embeds: embeds.slice(0, 5) });
        });
    }
}

export { GetFaqCommand };