import { EmbedBuilder } from 'discord.js';
import { google } from 'googleapis';
import { Command } from '../../utils/Command.js';
import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVICE_ACCOUNT_KEY_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
const CALENDAR_ID = process.env.GOOGLE_HOLIDAY_CALENDAR_ID || 'en.nepali#holiday@group.v.calendar.google.com';

let calendarClient = null;

const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

/**
 * Initializes the Google Calendar API client using a service account.
 * This function will be called once by the bot's main class.
 */
async function initializeGoogleCalendarClient() {
    if (!SERVICE_ACCOUNT_KEY_PATH || SERVICE_ACCOUNT_KEY_PATH === 'YOUR_GOOGLE_SERVICE_ACCOUNT_KEY_PATH') {
        console.warn(`[HolidaysCommand] Google Service Account Key path not configured in .env. Holidays command will be disabled.`);
        calendarClient = null;
        return;
    }

    const absoluteKeyPath = path.resolve(__dirname, '../../', SERVICE_ACCOUNT_KEY_PATH); 
    
    if (!await fs.access(absoluteKeyPath).then(() => true).catch(() => false)) {
        console.warn(`[HolidaysCommand] Google Service Account Key file not found at: ${absoluteKeyPath}. Holidays command will be disabled.`);
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

class HolidaysCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'holidays',
            description: 'Displays upcoming holidays from Google Calendar.',
            permissions: [],
            usage: '',
            dbInstance: options.dbInstance, 
        });
    }

    async execute(message, args) {
        if (!calendarClient) { 
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ Google Calendar API is not configured or failed to initialize. Please check bot logs and `.env` settings.')] });
        }
        if (!CALENDAR_ID || CALENDAR_ID === 'YOUR_GOOGLE_HOLIDAY_CALENDAR_ID') {
             return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ Google Holiday Calendar ID is not configured in `.env`.')] });
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
                    const start = event.start.date || event.start.dateTime; // Prefer date if it's an all-day event
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

            message.reply({ embeds: [embed] });
        } catch (error) {
            console.error('[HolidaysCommand] Error fetching holidays:', error.message);
            message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Failed to fetch holidays: ${error.message}. Please check bot logs.`)] });
        }
    }
}

export { HolidaysCommand, initializeGoogleCalendarClient };