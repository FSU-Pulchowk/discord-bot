// src/services/clubExcelService.js
import * as XLSX from 'xlsx';
import { promises as fs } from 'fs';
import path from 'path';
import { db } from '../database.js';
import { log } from '../utils/debug.js';

/**
 * Service for synchronizing club data with Excel files
 * Supports reading Excel files exported from Google Forms responses
 */
class ClubExcelService {
    constructor(client) {
        this.client = client;
        this.syncInProgress = new Set();
    }

    /**
     * Main synchronization method - reads Excel file and processes new entries
     * @param {string} syncType - Type of sync: 'clubs', 'members', 'events', 'join_requests'
     * @param {string} filePath - Path to Excel file
     * @returns {Promise<object>} Sync results
     */
    async syncFromExcel(syncType, filePath) {
        if (this.syncInProgress.has(syncType)) {
            log(`Sync already in progress for ${syncType}`, 'club', null, null, 'warn');
            return { success: false, error: 'Sync already in progress' };
        }

        this.syncInProgress.add(syncType);
        
        try {
            log(`Starting Excel sync for ${syncType} from ${filePath}`, 'club', null, null, 'info');
            
            // Update sync status
            await this.updateSyncStatus(syncType, 'in_progress', filePath);
            
            // Read Excel file
            const workbook = await this.readExcelFile(filePath);
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const data = XLSX.utils.sheet_to_json(worksheet);
            
            if (data.length === 0) {
                log(`No data found in Excel file for ${syncType}`, 'club', null, null, 'warn');
                return { success: true, processed: 0, skipped: 0 };
            }

            // Get last processed row to avoid duplicates
            const lastProcessed = await this.getLastProcessedRow(syncType);
            
            // Process new rows only
            const newRows = data.slice(lastProcessed);
            log(`Processing ${newRows.length} new rows for ${syncType}`, 'club', { total: data.length, lastProcessed });
            
            let processed = 0;
            let skipped = 0;
            let errors = [];

            for (let i = 0; i < newRows.length; i++) {
                try {
                    const row = newRows[i];
                    const rowNumber = lastProcessed + i + 1;
                    
                    const result = await this.processRow(syncType, row, rowNumber);
                    
                    if (result.success) {
                        processed++;
                    } else {
                        skipped++;
                        errors.push({ row: rowNumber, error: result.error });
                    }
                } catch (error) {
                    skipped++;
                    errors.push({ row: lastProcessed + i + 1, error: error.message });
                    log(`Error processing row ${lastProcessed + i + 1}`, 'club', null, error, 'error');
                }
            }

            // Update sync status
            await this.updateSyncStatus(
                syncType, 
                'success', 
                filePath, 
                lastProcessed + newRows.length,
                errors.length > 0 ? JSON.stringify(errors) : null
            );
            
            log(`Excel sync completed for ${syncType}`, 'club', { processed, skipped, errors: errors.length });
            
            return {
                success: true,
                processed,
                skipped,
                errors: errors.length > 0 ? errors : null
            };
            
        } catch (error) {
            log(`Excel sync failed for ${syncType}`, 'club', null, error, 'error');
            await this.updateSyncStatus(syncType, 'failed', filePath, null, error.message);
            return { success: false, error: error.message };
        } finally {
            this.syncInProgress.delete(syncType);
        }
    }

    /**
     * Read Excel file and return workbook
     */
    async readExcelFile(filePath) {
        try {
            const buffer = await fs.readFile(filePath);
            return XLSX.read(buffer, { type: 'buffer' });
        } catch (error) {
            throw new Error(`Failed to read Excel file: ${error.message}`);
        }
    }

    /**
     * Process a single row based on sync type
     */
    async processRow(syncType, row, rowNumber) {
        switch (syncType) {
            case 'join_requests':
                return await this.processJoinRequest(row, rowNumber);
            case 'club_registrations':
                return await this.processClubRegistration(row, rowNumber);
            case 'event_feedback':
                return await this.processEventFeedback(row, rowNumber);
            case 'attendance':
                return await this.processAttendance(row, rowNumber);
            default:
                return { success: false, error: 'Unknown sync type' };
        }
    }

    /**
     * Process club join request from Google Form
     * Expected columns: Timestamp, Email, Full Name, Roll Number, Club Name, Reason
     */
    async processJoinRequest(row, rowNumber) {
        try {
            const email = row['Email'] || row['Email Address'];
            const fullName = row['Full Name'] || row['Name'];
            const rollNumber = row['Roll Number'] || row['Roll No'];
            const clubName = row['Club Name'];
            const reason = row['Reason for Joining'] || row['Why do you want to join?'];
            
            if (!email || !clubName) {
                return { success: false, error: 'Missing required fields: email or club name' };
            }

            // Find user by email from verified_users table
            const user = await new Promise((resolve, reject) => {
                db.get(
                    `SELECT user_id, guild_id FROM verified_users WHERE email = ?`,
                    [email],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    }
                );
            });

            if (!user) {
                log(`User not found for email: ${email}`, 'club', null, null, 'warn');
                return { success: false, error: 'User not verified in Discord' };
            }

            // Find club
            const club = await new Promise((resolve, reject) => {
                db.get(
                    `SELECT id, role_id, max_members FROM clubs WHERE guild_id = ? AND LOWER(name) = LOWER(?) AND status = 'active'`,
                    [user.guild_id, clubName],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    }
                );
            });

            if (!club) {
                return { success: false, error: `Club "${clubName}" not found or inactive` };
            }

            // Check if already a member
            const existingMember = await new Promise((resolve, reject) => {
                db.get(
                    `SELECT id FROM club_members WHERE club_id = ? AND user_id = ?`,
                    [club.id, user.user_id],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    }
                );
            });

            if (existingMember) {
                return { success: false, error: 'Already a member of this club' };
            }

            // Check member capacity
            if (club.max_members) {
                const memberCount = await new Promise((resolve, reject) => {
                    db.get(
                        `SELECT COUNT(*) as count FROM club_members WHERE club_id = ? AND status = 'active'`,
                        [club.id],
                        (err, row) => {
                            if (err) reject(err);
                            else resolve(row?.count || 0);
                        }
                    );
                });

                if (memberCount >= club.max_members) {
                    return { success: false, error: 'Club has reached maximum capacity' };
                }
            }

            // Add member to club
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO club_members (club_id, user_id, guild_id, role, status) VALUES (?, ?, ?, 'member', 'active')`,
                    [club.id, user.user_id, user.guild_id],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });

            // Assign Discord role
            if (club.role_id) {
                try {
                    const guild = await this.client.guilds.fetch(user.guild_id);
                    const member = await guild.members.fetch(user.user_id);
                    const role = await guild.roles.fetch(club.role_id);
                    
                    if (member && role) {
                        await member.roles.add(role, `Joined club: ${clubName}`);
                    }
                } catch (roleError) {
                    log(`Failed to assign club role`, 'club', null, roleError, 'warn');
                }
            }

            // Store form submission
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO club_form_submissions (form_type, submission_id, user_email, user_id, data_json, processed, processed_at) 
                     VALUES (?, ?, ?, ?, ?, 1, ?)`,
                    [
                        'join_request',
                        `join_${rowNumber}_${Date.now()}`,
                        email,
                        user.user_id,
                        JSON.stringify({ fullName, rollNumber, clubName, reason }),
                        Date.now()
                    ],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });

            // Send welcome DM
            try {
                const discordUser = await this.client.users.fetch(user.user_id);
                await discordUser.send({
                    content: `🎉 Welcome to **${clubName}**! Your membership has been confirmed.\n\nCheck the club channel for announcements and upcoming events.`
                });
            } catch (dmError) {
                log(`Failed to send welcome DM`, 'club', null, dmError, 'warn');
            }

            log(`Successfully processed join request for ${email} to ${clubName}`, 'club');
            return { success: true };

        } catch (error) {
            log(`Error processing join request`, 'club', null, error, 'error');
            return { success: false, error: error.message };
        }
    }

    /**
     * Process club registration form (for creating new clubs)
     * Expected columns: Timestamp, President Email, Club Name, Description, Category, Max Members
     */
    async processClubRegistration(row, rowNumber) {
        try {
            const presidentEmail = row['President Email'] || row['Your Email'];
            const clubName = row['Club Name'];
            const description = row['Description'] || row['Club Description'];
            const category = row['Category'] || 'general';
            const maxMembers = row['Max Members'] ? parseInt(row['Max Members']) : null;
            const advisorName = row['Faculty Advisor'] || row['Advisor'];
            
            if (!presidentEmail || !clubName) {
                return { success: false, error: 'Missing required fields' };
            }

            // Find president user
            const president = await new Promise((resolve, reject) => {
                db.get(
                    `SELECT user_id, guild_id, real_name FROM verified_users WHERE email = ?`,
                    [presidentEmail],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    }
                );
            });

            if (!president) {
                return { success: false, error: 'President not verified in Discord' };
            }

            // Check if club already exists
            const existingClub = await new Promise((resolve, reject) => {
                db.get(
                    `SELECT id FROM clubs WHERE guild_id = ? AND LOWER(name) = LOWER(?)`,
                    [president.guild_id, clubName],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    }
                );
            });

            if (existingClub) {
                return { success: false, error: 'Club already exists' };
            }

            // Create club with pending status
            const clubId = await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO clubs (guild_id, name, description, category, president_user_id, advisor_name, max_members, status) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
                    [president.guild_id, clubName, description, category, president.user_id, advisorName, maxMembers],
                    function(err) {
                        if (err) reject(err);
                        else resolve(this.lastID);
                    }
                );
            });

            // Store form submission
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO club_form_submissions (form_type, submission_id, user_email, user_id, data_json, processed, processed_at) 
                     VALUES (?, ?, ?, ?, ?, 1, ?)`,
                    [
                        'club_registration',
                        `club_reg_${rowNumber}_${Date.now()}`,
                        presidentEmail,
                        president.user_id,
                        JSON.stringify({ clubName, description, category, maxMembers, advisorName }),
                        Date.now()
                    ],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });

            log(`Club registration created: ${clubName} (pending approval)`, 'club');
            return { success: true, clubId, status: 'pending' };

        } catch (error) {
            log(`Error processing club registration`, 'club', null, error, 'error');
            return { success: false, error: error.message };
        }
    }

    /**
     * Process event attendance from Excel
     * Expected columns: Event ID, Email/Roll Number, Attended (Yes/No), Notes
     */
    async processAttendance(row, rowNumber) {
        try {
            const eventId = row['Event ID'];
            const email = row['Email'] || row['Email Address'];
            const attended = (row['Attended'] || '').toLowerCase() === 'yes' || row['Present'] === 'Yes';
            
            if (!eventId || !email) {
                return { success: false, error: 'Missing required fields' };
            }

            // Find user
            const user = await new Promise((resolve, reject) => {
                db.get(
                    `SELECT user_id FROM verified_users WHERE email = ?`,
                    [email],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    }
                );
            });

            if (!user) {
                return { success: false, error: 'User not found' };
            }

            // Update RSVP attendance
            await new Promise((resolve, reject) => {
                db.run(
                    `UPDATE club_event_rsvps SET attended = ? WHERE event_id = ? AND user_id = ?`,
                    [attended ? 1 : 0, eventId, user.user_id],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });

            // If attended, increment member's attendance count
            if (attended) {
                const event = await new Promise((resolve, reject) => {
                    db.get(
                        `SELECT club_id FROM club_events WHERE id = ?`,
                        [eventId],
                        (err, row) => {
                            if (err) reject(err);
                            else resolve(row);
                        }
                    );
                });

                if (event) {
                    await new Promise((resolve, reject) => {
                        db.run(
                            `UPDATE club_members SET attendance_count = attendance_count + 1 
                             WHERE club_id = ? AND user_id = ?`,
                            [event.club_id, user.user_id],
                            (err) => {
                                if (err) reject(err);
                                else resolve();
                            }
                        );
                    });
                }
            }

            return { success: true };

        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Process event feedback
     */
    async processEventFeedback(row, rowNumber) {
        // Store feedback in database for later analysis
        try {
            const eventId = row['Event ID'];
            const email = row['Email'];
            const rating = row['Rating'] || row['Overall Rating'];
            const feedback = row['Feedback'] || row['Comments'];
            
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO club_form_submissions (form_type, submission_id, user_email, data_json, processed, processed_at) 
                     VALUES (?, ?, ?, ?, 1, ?)`,
                    [
                        'event_feedback',
                        `feedback_${rowNumber}_${Date.now()}`,
                        email,
                        JSON.stringify({ eventId, rating, feedback }),
                        Date.now()
                    ],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });

            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Get last processed row number for a sync type
     */
    async getLastProcessedRow(syncType) {
        return new Promise((resolve, reject) => {
            db.get(
                `SELECT last_row_processed FROM club_excel_sync WHERE sync_type = ?`,
                [syncType],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.last_row_processed || 0);
                }
            );
        });
    }

    /**
     * Update sync status in database
     */
    async updateSyncStatus(syncType, status, filePath, lastRow = null, errorMessage = null) {
        return new Promise((resolve, reject) => {
            const lastSync = status === 'success' ? Date.now() : null;
            
            db.run(
                `INSERT INTO club_excel_sync (sync_type, file_path, status, last_sync, last_row_processed, error_message) 
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(sync_type) DO UPDATE SET
                    file_path = excluded.file_path,
                    status = excluded.status,
                    last_sync = excluded.last_sync,
                    last_row_processed = COALESCE(excluded.last_row_processed, last_row_processed),
                    error_message = excluded.error_message`,
                [syncType, filePath, status, lastSync, lastRow, errorMessage],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    /**
     * Export club data to Excel format
     */
    async exportToExcel(exportType, outputPath) {
        try {
            let data;
            
            switch (exportType) {
                case 'clubs':
                    data = await this.getClubsData();
                    break;
                case 'members':
                    data = await this.getMembersData();
                    break;
                case 'events':
                    data = await this.getEventsData();
                    break;
                default:
                    throw new Error('Unknown export type');
            }

            const worksheet = XLSX.utils.json_to_sheet(data);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, exportType);
            
            XLSX.writeFile(workbook, outputPath);
            
            log(`Exported ${exportType} to ${outputPath}`, 'club');
            return { success: true, path: outputPath, rows: data.length };
            
        } catch (error) {
            log(`Export failed`, 'club', null, error, 'error');
            return { success: false, error: error.message };
        }
    }

    async getClubsData() {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT c.name, c.description, c.category, c.max_members, c.status,
                        v.real_name as president_name, v.email as president_email,
                        COUNT(cm.id) as member_count
                 FROM clubs c
                 LEFT JOIN verified_users v ON c.president_user_id = v.user_id
                 LEFT JOIN club_members cm ON c.id = cm.club_id AND cm.status = 'active'
                 GROUP BY c.id`,
                [],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
    }

    async getMembersData() {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT c.name as club_name, v.real_name, v.email, 
                        cm.role, cm.attendance_count, cm.contribution_points,
                        datetime(cm.joined_at, 'unixepoch') as joined_date
                 FROM club_members cm
                 JOIN clubs c ON cm.club_id = c.id
                 JOIN verified_users v ON cm.user_id = v.user_id
                 WHERE cm.status = 'active'
                 ORDER BY c.name, v.real_name`,
                [],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
    }

    async getEventsData() {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT c.name as club_name, e.title, e.event_type, e.date, 
                        e.start_time, e.location, e.status,
                        COUNT(r.id) as rsvp_count,
                        SUM(CASE WHEN r.attended = 1 THEN 1 ELSE 0 END) as attended_count
                 FROM club_events e
                 JOIN clubs c ON e.club_id = c.id
                 LEFT JOIN club_event_rsvps r ON e.id = r.event_id
                 GROUP BY e.id
                 ORDER BY e.date DESC`,
                [],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
    }
}

export { ClubExcelService };