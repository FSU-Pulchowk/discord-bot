import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { google } from 'googleapis';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVICE_ACCOUNT_KEY_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
const CALENDAR_ID = process.env.GOOGLE_HOLIDAY_CALENDAR_ID || 'en.nepali#holiday@group.v.calendar.google.com';

let calendarClient = null;

const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

export async function initializeGoogleCalendarClient() {
    if (!SERVICE_ACCOUNT_KEY_PATH || SERVICE_ACCOUNT_KEY_PATH === 'YOUR_GOOGLE_SERVICE_ACCOUNT_KEY_PATH') {
        console.warn(`[HolidaysCommand] Google Service Account Key path not configured in .env. Holidays command will be disabled.`);
        calendarClient = null;
        return;
    }

    const absoluteKeyPath = path.resolve(__dirname, '../../', SERVICE_ACCOUNT_KEY_PATH); 
    
    if (!await fs.access(absoluteKeyPath).then(() => true).catch(() => false)) {
        console.warn(`[HolidaysCommand] Google Service Account Key file not found at respective path. Holidays command will be disabled.`);
        calendarClient = null;
        return;
    }

    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: absoluteKeyPath,
            scopes: CALENDAR_SCOPES,
        });

        const authClient = await auth.getClient();
        calendarClient = google.calendar({ version: 'v3', auth: authClient });
        console.log('[HolidaysCommand] Google Calendar API client authorized successfully.');
    } catch (error) {
        console.error('[HolidaysCommand] Error initializing Google Calendar API client:', error.message);
        calendarClient = null;
    }
}

export const data = new SlashCommandBuilder()
    .setName('holidays')
    .setDescription('Displays upcoming holidays from Google Calendar.')
    .setDMPermission(false); // Does not make sense in DMs as it's guild-specific info

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    if (!calendarClient) { 
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ Google Calendar API is not configured or failed to initialize. Please check bot logs and `.env` settings.')], ephemeral: true });
    }
    if (!CALENDAR_ID || CALENDAR_ID === 'YOUR_GOOGLE_HOLIDAY_CALENDAR_ID') {
         return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ Google Holiday Calendar ID is not configured in `.env`.')], ephemeral: true });
    }

    try {
        const now = new Date();
        const oneYearFromNow = new Date();
        oneYearFromNow.setFullYear(now.getFullYear() + 1);

        const response = await calendarClient.events.list({ 
            calendarId: CALENDAR_ID,
            timeMin: now.toISOString(),
            timeMax: oneYearFromNow.toISOString(),
            maxResults: 10,
            singleEvents: true,
            orderBy: 'startTime',
        });

        const events = response.data.items;
        let holidaysList = [];

        if (events && events.length > 0) {
            events.forEach(event => {
                const start = event.start.date || event.start.dateTime;
                holidaysList.push(`• **${event.summary}**: ${new Date(start).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Kathmandu' })}`);
            });
        } else {
            holidaysList.push("No upcoming holidays found in the calendar for the next year.");
        }

        const embed = new EmbedBuilder()
            .setColor('#32CD32') 
            .setTitle('🎉 Upcoming Holidays')
            .setDescription('Relevant holidays (source: Google Calendar):')
            .addFields(
                { name: 'Holidays', value: holidaysList.join('\n') || "None found." },
                { name: 'Official Source', value: 'Always verify with the official [Pulchowk Campus Academic Calendar](https://pcampus.edu.np/academic-calender/).' }
            )
            .setFooter({ text: 'Fetched via Google Calendar API.' })
            .setTimestamp();

        interaction.reply({ embeds: [embed] });
    } catch (error) {
        console.error('[HolidaysCommand] Error fetching holidays:', error.message);
        interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Failed to fetch holidays: ${error.message}. Please check bot logs.`)], ephemeral: true });
    }
}
