// src/services/clubAutomation.js
import schedule from 'node-schedule';
import { db } from '../database.js';
import { ClubExcelService } from './clubExcelService.js';
import { EmbedBuilder, ChannelType, PermissionsBitField } from 'discord.js';
import { log } from '../utils/debug.js';
import path from 'path';
import fs from 'fs';

/**
 * Automated club management system
 * Handles scheduled tasks, auto-approvals, reminders, etc.
 */
class ClubAutomation {
    constructor(client) {
        this.client = client;
        this.excelService = new ClubExcelService(client);
        this.scheduledJobs = [];

        // Configuration from environment
        this.config = {
            autoSyncEnabled: process.env.CLUB_AUTO_SYNC_ENABLED === 'true',
            syncInterval: parseInt(process.env.CLUB_SYNC_INTERVAL_MINUTES || '30'),
            joinRequestsPath: process.env.CLUB_JOIN_REQUESTS_PATH || './data/join_requests.xlsx',
            clubRegistrationsPath: process.env.CLUB_REGISTRATIONS_PATH || './data/club_registrations.xlsx',
            attendancePath: process.env.CLUB_ATTENDANCE_PATH || './data/attendance.xlsx',
            eventReminderHours: parseInt(process.env.CLUB_EVENT_REMINDER_HOURS || '24'),
            inactiveWarningDays: parseInt(process.env.CLUB_INACTIVE_WARNING_DAYS || '30'),
            autoApproveClubs: process.env.CLUB_AUTO_APPROVE === 'true',
        };
    }

    /**
     * Initialize all automation schedules
     */
    initializeSchedules() {
        log('Initializing club management automation', 'club');

        // Auto-sync Excel files every X minutes
        if (this.config.autoSyncEnabled) {
            const syncJob = schedule.scheduleJob(`*/${this.config.syncInterval} * * * *`, async () => {
                await this.autoSyncExcelFiles();
            });
            this.scheduledJobs.push({ name: 'auto-sync', job: syncJob });
            log(`Scheduled auto-sync every ${this.config.syncInterval} minutes`, 'club');
        }

        // Event reminders - check every hour
        const reminderJob = schedule.scheduleJob('0 * * * *', async () => {
            await this.sendEventReminders();
        });
        this.scheduledJobs.push({ name: 'event-reminders', job: reminderJob });

        // Daily summary at 9 AM
        const summaryJob = schedule.scheduleJob('0 9 * * *', async () => {
            await this.sendDailySummary();
        });
        this.scheduledJobs.push({ name: 'daily-summary', job: summaryJob });

        // Weekly club reports on Monday at 10 AM
        const weeklyReportJob = schedule.scheduleJob('0 10 * * 1', async () => {
            await this.sendWeeklyReports();
        });
        this.scheduledJobs.push({ name: 'weekly-reports', job: weeklyReportJob });

        // Check for inactive clubs - weekly on Sunday
        const inactiveCheckJob = schedule.scheduleJob('0 12 * * 0', async () => {
            await this.checkInactiveClubs();
        });
        this.scheduledJobs.push({ name: 'inactive-check', job: inactiveCheckJob });

        // Update member stats - daily at midnight
        const statsUpdateJob = schedule.scheduleJob('0 0 * * *', async () => {
            await this.updateMemberStats();
        });
        this.scheduledJobs.push({ name: 'stats-update', job: statsUpdateJob });

        log(`Initialized ${this.scheduledJobs.length} automation schedules`, 'club');
    }

    /**
     * Auto-sync Excel files from configured paths
     */
    async autoSyncExcelFiles() {
        log('Running auto-sync for Excel files', 'club');

        const syncTasks = [
            { type: 'join_requests', path: this.config.joinRequestsPath },
            { type: 'club_registrations', path: this.config.clubRegistrationsPath },
            { type: 'attendance', path: this.config.attendancePath },
        ];

        for (const task of syncTasks) {
            try {
                if (!fs.existsSync(task.path)) {
                    continue;
                }

                const result = await this.excelService.syncFromExcel(task.type, task.path);

                if (result.success && result.processed > 0) {
                    log(`Auto-sync successful for ${task.type}: ${result.processed} processed`, 'club');

                    // Notify admins if there were any issues
                    if (result.errors && result.errors.length > 0) {
                        await this.notifyAdmins(`⚠️ Auto-sync for ${task.type} completed with ${result.errors.length} errors`);
                    }
                }
            } catch (error) {
                log(`Auto-sync failed for ${task.type}`, 'club', null, error, 'error');
                await this.notifyAdmins(`❌ Auto-sync failed for ${task.type}: ${error.message}`);
            }
        }
    }

    /**
     * Send reminders for upcoming events
     */
    async sendEventReminders() {
        log('Checking for events requiring reminders', 'club');

        try {
            const reminderTime = new Date();
            reminderTime.setHours(reminderTime.getHours() + this.config.eventReminderHours);

            const events = await new Promise((resolve, reject) => {
                db.all(
                    `SELECT e.*, c.name as club_name, c.role_id 
                     FROM club_events e
                     JOIN clubs c ON e.club_id = c.id
                     WHERE e.status = 'scheduled' 
                     AND datetime(e.event_date || ' ' || COALESCE(e.start_time, '00:00')) 
                         BETWEEN datetime('now') AND datetime(?, 'unixepoch')`,
                    [Math.floor(reminderTime.getTime() / 1000)],
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows || []);
                    }
                );
            });

            for (const event of events) {
                await this.sendEventReminder(event);
            }

            log(`Sent reminders for ${events.length} events`, 'club');
        } catch (error) {
            log('Error sending event reminders', 'club', null, error, 'error');
        }
    }

    /**
     * Send reminder for a specific event
     */
    async sendEventReminder(event) {
        try {
            // Get RSVPs
            const rsvps = await new Promise((resolve, reject) => {
                db.all(
                    `SELECT user_id FROM event_participants WHERE event_id = ? AND rsvp_status = 'going'`,
                    [event.id],
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows || []);
                    }
                );
            });

            const embed = new EmbedBuilder()
                .setColor('#FFD700')
                .setTitle(`⏰ Event Reminder: ${event.title}`)
                .setDescription(`This event is coming up in ${this.config.eventReminderHours} hours!`)
                .addFields(
                    { name: '📅 Date & Time', value: `${event.event_date} at ${event.start_time || 'TBA'}`, inline: true },
                    { name: '📍 Location', value: event.venue || 'TBA', inline: true },
                    { name: '🏛️ Club', value: event.club_name, inline: true }
                );

            if (event.description) {
                embed.addFields({ name: '📝 Details', value: event.description.substring(0, 200) });
            }

            // Send to all RSVP'd members
            for (const rsvp of rsvps) {
                try {
                    const user = await this.client.users.fetch(rsvp.user_id);
                    await user.send({ embeds: [embed] });
                } catch (dmError) {
                    log(`Failed to send reminder to user ${rsvp.user_id}`, 'club', null, dmError, 'warn');
                }
            }

            // Also announce in club channel if available
            if (event.role_id) {
                const guilds = this.client.guilds.cache;
                for (const [, guild] of guilds) {
                    const club = await new Promise((resolve, reject) => {
                        db.get(
                            `SELECT channel_id FROM clubs WHERE role_id = ?`,
                            [event.role_id],
                            (err, row) => {
                                if (err) reject(err);
                                else resolve(row);
                            }
                        );
                    });

                    if (club?.channel_id) {
                        const channel = await guild.channels.fetch(club.channel_id);
                        if (channel) {
                            await channel.send({ content: `<@&${event.role_id}>`, embeds: [embed] });
                        }
                    }
                }
            }

        } catch (error) {
            log(`Error sending reminder for event ${event.id}`, 'club', null, error, 'error');
        }
    }

    /**
     * Send daily summary to admins
     */
    async sendDailySummary() {
        log('Generating daily club summary', 'club');

        try {
            const stats = await this.getDailyStats();

            const embed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('📊 Daily Club Summary')
                .setDescription('Overview of club activities from the past 24 hours')
                .addFields(
                    { name: '👥 New Members', value: stats.newMembers.toString(), inline: true },
                    { name: '📋 Pending Join Requests', value: stats.pendingJoins.toString(), inline: true },
                    { name: '🏛️ New Club Registrations', value: stats.newClubs.toString(), inline: true },
                    { name: '📅 Upcoming Events (7 days)', value: stats.upcomingEvents.toString(), inline: true },
                    { name: '✅ Events Today', value: stats.eventsToday.toString(), inline: true },
                    { name: '⚠️ Clubs Needing Attention', value: stats.inactiveClubs.toString(), inline: true }
                )
                .setTimestamp();

            await this.notifyAdmins(null, embed);

        } catch (error) {
            log('Error generating daily summary', 'club', null, error, 'error');
        }
    }

    /**
     * Get statistics for daily summary
     */
    async getDailyStats() {
        const yesterday = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);

        const newMembers = await new Promise((resolve, reject) => {
            db.get(
                `SELECT COUNT(*) as count FROM club_members WHERE joined_at >= ?`,
                [yesterday],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.count || 0);
                }
            );
        });

        const pendingJoins = await new Promise((resolve, reject) => {
            db.get(
                `SELECT COUNT(*) as count FROM club_form_submissions 
                 WHERE form_type = 'join_request' AND processed = 0`,
                [],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.count || 0);
                }
            );
        });

        const newClubs = await new Promise((resolve, reject) => {
            db.get(
                `SELECT COUNT(*) as count FROM clubs WHERE status = 'pending' AND created_at >= ?`,
                [yesterday],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.count || 0);
                }
            );
        });

        const upcomingEvents = await new Promise((resolve, reject) => {
            db.get(
                `SELECT COUNT(*) as count FROM club_events 
                 WHERE status = 'scheduled' AND event_date BETWEEN date('now') AND date('now', '+7 days')`,
                [],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.count || 0);
                }
            );
        });

        const eventsToday = await new Promise((resolve, reject) => {
            db.get(
                `SELECT COUNT(*) as count FROM club_events 
                 WHERE status = 'scheduled' AND event_date = date('now')`,
                [],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.count || 0);
                }
            );
        });

        const inactiveClubs = await new Promise((resolve, reject) => {
            const warningDate = Math.floor((Date.now() - this.config.inactiveWarningDays * 24 * 60 * 60 * 1000) / 1000);
            db.get(
                `SELECT COUNT(DISTINCT c.id) as count 
                 FROM clubs c
                 LEFT JOIN club_events e ON c.id = e.club_id AND e.created_at >= ?
                 LEFT JOIN club_announcements a ON c.id = a.club_id AND a.created_at >= ?
                 WHERE c.status = 'active' AND e.id IS NULL AND a.id IS NULL`,
                [warningDate, warningDate],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.count || 0);
                }
            );
        });

        return {
            newMembers,
            pendingJoins,
            newClubs,
            upcomingEvents,
            eventsToday,
            inactiveClubs
        };
    }

    /**
     * Send weekly reports to club presidents
     */
    async sendWeeklyReports() {
        log('Generating weekly club reports', 'club');

        try {
            const clubs = await new Promise((resolve, reject) => {
                db.all(
                    `SELECT * FROM clubs WHERE status = 'active'`,
                    [],
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows || []);
                    }
                );
            });

            for (const club of clubs) {
                await this.sendClubWeeklyReport(club);
            }

            log(`Sent weekly reports for ${clubs.length} clubs`, 'club');
        } catch (error) {
            log('Error sending weekly reports', 'club', null, error, 'error');
        }
    }

    /**
     * Send weekly report for a specific club
     */
    async sendClubWeeklyReport(club) {
        try {
            const weekAgo = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);

            // Get stats
            const newMembers = await new Promise((resolve, reject) => {
                db.get(
                    `SELECT COUNT(*) as count FROM club_members 
                     WHERE club_id = ? AND joined_at >= ?`,
                    [club.id, weekAgo],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row?.count || 0);
                    }
                );
            });

            const totalMembers = await new Promise((resolve, reject) => {
                db.get(
                    `SELECT COUNT(*) as count FROM club_members 
                     WHERE club_id = ? AND status = 'active'`,
                    [club.id],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row?.count || 0);
                    }
                );
            });

            const upcomingEvents = await new Promise((resolve, reject) => {
                db.all(
                    `SELECT title, event_date, start_time FROM club_events 
                     WHERE club_id = ? AND event_date >= date('now') AND status = 'scheduled'
                     ORDER BY event_date LIMIT 5`,
                    [club.id],
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows || []);
                    }
                );
            });

            const embed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle(`📊 Weekly Report - ${club.name}`)
                .setDescription('Your club\'s activity summary for the past week')
                .addFields(
                    { name: '👥 Total Members', value: totalMembers.toString(), inline: true },
                    { name: '🆕 New Members This Week', value: newMembers.toString(), inline: true },
                    { name: '📅 Upcoming Events', value: upcomingEvents.length.toString(), inline: true }
                );

            if (upcomingEvents.length > 0) {
                const eventList = upcomingEvents.map(e => `• ${e.title} - ${e.event_date}`).join('\n');
                embed.addFields({ name: '📆 Next Events', value: eventList });
            }

            embed.setTimestamp();

            // Send to president
            if (club.president_user_id) {
                try {
                    const president = await this.client.users.fetch(club.president_user_id);
                    await president.send({ embeds: [embed] });
                } catch (dmError) {
                    log(`Failed to send report to president of ${club.name}`, 'club', null, dmError, 'warn');
                }
            }

            // Also post in club channel
            if (club.channel_id) {
                try {
                    for (const [, guild] of this.client.guilds.cache) {
                        const channel = await guild.channels.fetch(club.channel_id).catch(() => null);
                        if (channel) {
                            await channel.send({ embeds: [embed] });
                            break;
                        }
                    }
                } catch (channelError) {
                    log(`Failed to post report in channel for ${club.name}`, 'club', null, channelError, 'warn');
                }
            }

        } catch (error) {
            log(`Error sending weekly report for club ${club.id}`, 'club', null, error, 'error');
        }
    }

    /**
     * Check for inactive clubs and send warnings
     */
    async checkInactiveClubs() {
        log('Checking for inactive clubs', 'club');

        try {
            const warningDate = Math.floor((Date.now() - this.config.inactiveWarningDays * 24 * 60 * 60 * 1000) / 1000);

            const inactiveClubs = await new Promise((resolve, reject) => {
                db.all(
                    `SELECT c.*, 
                     MAX(e.created_at) as last_event,
                     MAX(a.created_at) as last_announcement
                     FROM clubs c
                     LEFT JOIN club_events e ON c.id = e.club_id
                     LEFT JOIN club_announcements a ON c.id = a.club_id
                     WHERE c.status = 'active'
                     GROUP BY c.id
                     HAVING (last_event IS NULL OR last_event < ?) 
                     AND (last_announcement IS NULL OR last_announcement < ?)`,
                    [warningDate, warningDate],
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows || []);
                    }
                );
            });

            for (const club of inactiveClubs) {
                await this.sendInactivityWarning(club);
            }

            log(`Sent inactivity warnings to ${inactiveClubs.length} clubs`, 'club');
        } catch (error) {
            log('Error checking inactive clubs', 'club', null, error, 'error');
        }
    }

    /**
     * Send inactivity warning to club president
     */
    async sendInactivityWarning(club) {
        try {
            const embed = new EmbedBuilder()
                .setColor('#FFA500')
                .setTitle(`⚠️ Inactivity Notice - ${club.name}`)
                .setDescription(`Your club has shown no activity in the past ${this.config.inactiveWarningDays} days.`)
                .addFields(
                    { name: '📌 Action Required', value: 'Please schedule an event or post an announcement to keep your club active.' },
                    { name: '⏰ Timeline', value: 'If no activity is detected in the next 14 days, the club may be marked as inactive.' }
                )
                .setTimestamp();

            if (club.president_user_id) {
                const president = await this.client.users.fetch(club.president_user_id);
                await president.send({ embeds: [embed] });
            }

            // Notify admins
            await this.notifyAdmins(`⚠️ Club "${club.name}" has been inactive for ${this.config.inactiveWarningDays} days`);

        } catch (error) {
            log(`Error sending inactivity warning for club ${club.id}`, 'club', null, error, 'error');
        }
    }

    /**
     * Update member statistics (contribution points, etc.)
     */
    async updateMemberStats() {
        log('Updating member statistics', 'club');

        try {
            // Award points for attendance
            await new Promise((resolve, reject) => {
                db.run(
                    `UPDATE club_members 
                     SET contribution_points = contribution_points + (attendance_count * 10)
                     WHERE attendance_count > 0`,
                    [],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });

            log('Member statistics updated successfully', 'club');
        } catch (error) {
            log('Error updating member stats', 'club', null, error, 'error');
        }
    }

    /**
     * Notify admins (sends to admin channel or DMs)
     */
    async notifyAdmins(message, embed = null) {
        const CLUB_ADMIN_CHANNEL_ID = process.env.CLUB_ADMIN_CHANNEL_ID;

        if (!CLUB_ADMIN_CHANNEL_ID || CLUB_ADMIN_CHANNEL_ID === 'YOUR_CLUB_ADMIN_CHANNEL_ID') {
            return;
        }

        try {
            for (const [, guild] of this.client.guilds.cache) {
                const channel = await guild.channels.fetch(CLUB_ADMIN_CHANNEL_ID).catch(() => null);
                if (channel) {
                    if (embed) {
                        await channel.send({ embeds: [embed] });
                    } else if (message) {
                        await channel.send(message);
                    }
                    break;
                }
            }
        } catch (error) {
            log('Error notifying admins', 'club', null, error, 'warn');
        }
    }

    /**
     * Graceful shutdown
     */
    shutdown() {
        log('Shutting down club automation', 'club');

        this.scheduledJobs.forEach(({ name, job }) => {
            job.cancel();
            log(`Cancelled job: ${name}`, 'club');
        });

        this.scheduledJobs = [];
    }
}

export { ClubAutomation };