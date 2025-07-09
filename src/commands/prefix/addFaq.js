import { EmbedBuilder, PermissionsBitField } from 'discord.js';
import { Command } from '../../utils/Command.js';

class AddFaqCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'addfaq',
            description: 'Adds a new Frequently Asked Question to the knowledge base.',
            permissions: [PermissionsBitField.Flags.Administrator, PermissionsBitField.Flags.ManageGuild],
            usage: '<"Question"> <"Answer"> [keywords (comma-separated)]',
            dbInstance: options.dbInstance,
        });
    }
    async execute(message, args) {
        const rawContent = message.content.slice(this.client.PREFIX.length + this.name.length).trim();
        const regex = /"([^"]*)"/g;
        const matches = [];
        let match;
        while ((match = regex.exec(rawContent)) !== null) {
            matches.push(match[1]);
        }

        if (matches.length < 2) {
            return this.sendUsage(message, `Example: \`${this.client.PREFIX}addfaq "What is FSU?" "FSU stands for Free Student Union Pulchowk Campus." "FSU, Pulchowk, union"\``);
        }

        const question = matches[0];
        const answer = matches[1];
        let lastQuoteEndIndex = 0;
        let quoteCount = 0;
        for(let i = 0; i < rawContent.length; i++) {
            if(rawContent[i] === '"') {
                quoteCount++;
                if(quoteCount === 4) { 
                    lastQuoteEndIndex = i + 1;
                    break;
                }
            }
        }
        if(quoteCount < 4 && matches.length === 2) {
             lastQuoteEndIndex = rawContent.lastIndexOf(matches[1]) + matches[1].length + 1;
        }
        const remainingContent = rawContent.substring(lastQuoteEndIndex).trim();
        const keywords = remainingContent ? remainingContent.split(',').map(k => k.trim().toLowerCase()).join(',') : null;
        this.db.run(`INSERT INTO faqs (guild_id, question, answer, keywords, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
            [message.guild.id, question, answer, keywords, message.author.id, Date.now()],
            function(err) {
                if (err) {
                    console.error('Error inserting FAQ into database:', err.message);
                    const embed = new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error adding FAQ: ${err.message}`);
                    return message.reply({ embeds: [embed] });
                }
                const embed = new EmbedBuilder().setColor('#00FF00').setTitle('✅ FAQ Added').setDescription(`FAQ ID **#${this.lastID}** added.`)
                    .addFields(
                        { name: 'Question', value: question, inline: false },
                        { name: 'Answer', value: answer, inline: false },
                        { name: 'Keywords', value: keywords || 'None', inline: true },
                        { name: 'Added By', value: message.author.tag, inline: true }
                    ).setTimestamp();
                message.reply({ embeds: [embed] });
            }
        );
    }
}

export { AddFaqCommand };