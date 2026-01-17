// src/utils/excelExporter.js
import ExcelJS from 'exceljs';
import { db } from '../database.js';
import { log } from './debug.js';

/**
 * Export event participants to Excel file
 * @param {number} eventId - Event ID
 * @returns {Promise<Buffer>} Excel file buffer
 */
export async function exportEventParticipants(eventId) {
    try {
        // Get event details
        const event = await getEventDetails(eventId);
        if (!event) {
            throw new Error('Event not found');
        }

        // Get participants with all details
        const participants = await getEventParticipants(eventId);

        // Create workbook
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'FSU Discord Bot';
        workbook.created = new Date();

        // Generate participant sheet
        await generateParticipantSheet(workbook, event, participants);

        // Generate buffer
        const buffer = await workbook.xlsx.writeBuffer();

        log('Excel export generated', 'export', { eventId, participantCount: participants.length }, null, 'success');

        return buffer;

    } catch (error) {
        log('Error generating Excel export', 'export', { eventId }, error, 'error');
        throw error;
    }
}

/**
 * Get event details
 * @param {number} eventId - Event ID
 * @returns {Promise<Object>} Event object
 */
async function getEventDetails(eventId) {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT e.*, c.name as club_name, c.slug as club_slug
             FROM club_events e
             JOIN clubs c ON e.club_id = c.id
             WHERE e.id = ?`,
            [eventId],
            (err, row) => {
                if (err) reject(err);
                else resolve(row);
            }
        );
    });
}

/**
 * Get event participants with payment and registration details
 * @param {number} eventId - Event ID
 * @returns {Promise<Array>} Array of participant objects
 */
async function getEventParticipants(eventId) {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT 
                ep.user_id,
                ep.registration_date,
                ep.rsvp_status,
                ep.checked_in,
                ep.checked_in_at,
                ep.team_name,
                ep.team_id,
                ep.is_team_captain,
                vu.real_name,
                vu.email,
                vu.batch,
                vu.faculty,
                er.payment_proof_url,
                er.payment_status,
                er.payment_verified_by,
                er.payment_verified_at,
                er.registration_notes
             FROM event_participants ep
             LEFT JOIN verified_users vu ON ep.user_id = vu.user_id
             LEFT JOIN event_registrations er ON ep.event_id = er.event_id AND ep.user_id = er.user_id
             WHERE ep.event_id = ?
             ORDER BY ep.registration_date ASC`,
            [eventId],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            }
        );
    });
}

/**
 * Generate participant sheet in workbook
 * @param {ExcelJS.Workbook} workbook - Excel workbook
 * @param {Object} event - Event details
 * @param {Array} participants - Participant data
 */
async function generateParticipantSheet(workbook, event, participants) {
    const sheet = workbook.addWorksheet('Participants');

    // Set column widths and headers
    sheet.columns = [
        { header: '#', key: 'number', width: 5 },
        { header: 'Name', key: 'name', width: 25 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'Discord ID', key: 'userId', width: 20 },
        { header: 'Batch', key: 'batch', width: 10 },
        { header: 'Faculty', key: 'faculty', width: 15 },
        { header: 'Registration Date', key: 'regDate', width: 18 },
        { header: 'Payment Required', key: 'paymentRequired', width: 16 },
        { header: 'Payment Status', key: 'paymentStatus', width: 15 },
        { header: 'Transaction Proof', key: 'proofUrl', width: 40 },
        { header: 'Verified By', key: 'verifiedBy', width: 20 },
        { header: 'RSVP Status', key: 'rsvpStatus', width: 12 },
        { header: 'Checked In', key: 'checkedIn', width: 12 },
        { header: 'Team Name', key: 'teamName', width: 20 },
        { header: 'Team Captain', key: 'teamCaptain', width: 12 },
        { header: 'Notes', key: 'notes', width: 30 }
    ];

    // Style header row
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
    };
    sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

    // Add event info at top
    sheet.insertRow(1, ['Event:', event.title]);
    sheet.insertRow(2, ['Club:', event.club_name]);
    sheet.insertRow(3, ['Date:', event.event_date]);
    sheet.insertRow(4, ['Location:', event.venue || 'N/A']);
    sheet.insertRow(5, ['Registration Fee:', event.registration_fee ? `Rs. ${event.registration_fee}` : 'Free']);
    sheet.insertRow(6, []); // Empty row

    // Style event info
    for (let i = 1; i <= 5; i++) {
        sheet.getRow(i).font = { bold: true };
        sheet.getRow(i).getCell(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE7E6E6' }
        };
    }

    // Header is now at row 7 due to event info
    const headerRow = 7;
    sheet.getRow(headerRow).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(headerRow).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
    };
    sheet.getRow(headerRow).alignment = { vertical: 'middle', horizontal: 'center' };

    // Add participant data
    participants.forEach((participant, index) => {
        const rowData = {
            number: index + 1,
            name: participant.real_name || 'Unknown',
            email: participant.email || 'N/A',
            userId: participant.user_id,
            batch: participant.batch || 'N/A',
            faculty: participant.faculty || 'N/A',
            regDate: participant.registration_date
                ? new Date(participant.registration_date * 1000).toLocaleString()
                : 'N/A',
            paymentRequired: event.registration_fee && event.registration_fee > 0 ? 'Yes' : 'No',
            paymentStatus: participant.payment_status
                ? participant.payment_status.charAt(0).toUpperCase() + participant.payment_status.slice(1)
                : (event.registration_fee > 0 ? 'Pending' : 'N/A'),
            proofUrl: participant.payment_proof_url || 'N/A',
            verifiedBy: participant.payment_verified_by || 'N/A',
            rsvpStatus: participant.rsvp_status || 'going',
            checkedIn: participant.checked_in ? 'Yes' : 'No',
            teamName: participant.team_name || 'N/A',
            teamCaptain: participant.is_team_captain ? 'Yes' : 'No',
            notes: participant.registration_notes || ''
        };

        const row = sheet.addRow(rowData);

        // Color code payment status
        if (event.registration_fee > 0) {
            const statusCell = row.getCell('paymentStatus');
            switch (participant.payment_status) {
                case 'verified':
                    statusCell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFC6EFCE' } // Light green
                    };
                    break;
                case 'rejected':
                    statusCell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFFFC7CE' } // Light red
                    };
                    break;
                case 'pending':
                    statusCell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFFFEB9C' } // Light yellow
                    };
                    break;
            }
        }

        // Make proof URL clickable if exists
        if (participant.payment_proof_url && participant.payment_proof_url !== 'N/A') {
            const proofCell = row.getCell('proofUrl');
            proofCell.value = {
                text: 'View Proof',
                hyperlink: participant.payment_proof_url
            };
            proofCell.font = { color: { argb: 'FF0563C1' }, underline: true };
        }
    });

    // Add summary at bottom
    const summaryRow = sheet.rowCount + 2;
    sheet.getRow(summaryRow).values = ['SUMMARY'];
    sheet.getRow(summaryRow).font = { bold: true, size: 14 };

    sheet.getRow(summaryRow + 1).values = ['Total Participants:', participants.length];
    sheet.getRow(summaryRow + 2).values = ['Checked In:', participants.filter(p => p.checked_in).length];

    if (event.registration_fee > 0) {
        const verified = participants.filter(p => p.payment_status === 'verified').length;
        const pending = participants.filter(p => p.payment_status === 'pending').length;
        const rejected = participants.filter(p => p.payment_status === 'rejected').length;

        sheet.getRow(summaryRow + 3).values = ['Payment Verified:', verified];
        sheet.getRow(summaryRow + 4).values = ['Payment Pending:', pending];
        sheet.getRow(summaryRow + 5).values = ['Payment Rejected:', rejected];
        sheet.getRow(summaryRow + 6).values = ['Total Revenue:', `Rs. ${verified * event.registration_fee}`];
    }

    // Auto-filter on header row
    sheet.autoFilter = {
        from: { row: headerRow, column: 1 },
        to: { row: headerRow, column: sheet.columnCount }
    };

    // Freeze header rows
    sheet.views = [
        { state: 'frozen', xSplit: 0, ySplit: headerRow }
    ];
}

/**
 * Generate filename for export
 * @param {Object} event - Event details
 * @returns {string} Filename
 */
export function generateExportFilename(event) {
    const date = new Date().toISOString().split('T')[0];
    const safeName = event.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    return `${event.club_slug}_${safeName}_participants_${date}.xlsx`;
}

/**
 * Check if event deadline has passed
 * @param {number} eventId - Event ID
 * @returns {Promise<boolean>} True if deadline passed
 */
export async function isEventDeadlinePassed(eventId) {
    const event = await getEventDetails(eventId);
    if (!event) return false;

    if (!event.registration_deadline) {
        // If no deadline set, use event date
        const eventDateTime = new Date(`${event.event_date}T${event.start_time || '00:00'}`);
        return Date.now() > eventDateTime.getTime();
    }

    const deadline = new Date(event.registration_deadline);
    return Date.now() > deadline.getTime();
}

/**
 * Auto-export participants for finished events
 * This should be called as a scheduled task
 */
export async function autoExportFinishedEvents() {
    try {
        // Get events with passed deadlines that haven't been exported
        const events = await new Promise((resolve, reject) => {
            db.all(
                `SELECT id, title, registration_deadline, event_date 
                 FROM club_events 
                 WHERE status = 'scheduled' 
                 AND exported_at IS NULL`,
                [],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        for (const event of events) {
            const deadlinePassed = await isEventDeadlinePassed(event.id);

            if (deadlinePassed) {
                log(`Auto-exporting participants for event ${event.id}`, 'export', { eventId: event.id });

                // Generate export
                const buffer = await exportEventParticipants(event.id);

                // Mark as exported
                await new Promise((resolve, reject) => {
                    db.run(
                        `UPDATE club_events SET exported_at = strftime('%s', 'now') WHERE id = ?`,
                        [event.id],
                        (err) => {
                            if (err) reject(err);
                            else resolve();
                        }
                    );
                });

                // TODO: Send to club moderators via DM
                // This would require guild/client context
            }
        }

    } catch (error) {
        log('Error in auto-export', 'export', null, error, 'error');
    }
}
