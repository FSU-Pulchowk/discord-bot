import { google } from 'googleapis';
import dotenv from 'dotenv';
import { log } from '../utils/debug.js';

dotenv.config();

class emailService {
    constructor() {
        this.googleClientId = process.env.GOOGLE_CLIENT_ID;
        this.googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
        this.redirectUri = process.env.REDIRECT_URI;
        this.refreshToken = process.env.REFRESH_TOKEN;
        this.senderEmail = process.env.SENDER_EMAIL;

        this.validateConfig();

        this.oAuth2Client = new google.auth.OAuth2(
            this.googleClientId,
            this.googleClientSecret,
            this.redirectUri
        );
        this.oAuth2Client.setCredentials({ refresh_token: this.refreshToken });
    }

    /**
     * Validates that all necessary environment variables for Google API are set.
     * Exits the process if any critical variable is missing.
     */
    validateConfig() {
        if (!this.googleClientId || !this.googleClientSecret || !this.redirectUri || !this.refreshToken || !this.senderEmail) {
            log("Missing one or more Google API environment variables. Please check your .env file.", 'error');
            process.exit(1);
        }
    }

    /**
     * Sends an email using the Gmail API.
     * @param {string} to - Recipient email address.
     * @param {string} subject - Email subject.
     * @param {string} htmlContent - Email body in HTML format.
     * @returns {Promise<object>} The response data from the Gmail API.
     * @throws {Error} If email sending fails.
     */
    async sendEmail(to, subject, htmlContent) {
        try {
            const { token: accessToken } = await this.oAuth2Client.getAccessToken();
            const transport = google.gmail({ version: 'v1', auth: this.oAuth2Client });

            const emailContent = [
                `From: ${this.senderEmail}`,
                `To: ${to}`,
                `Subject: ${subject}`,
                `Content-Type: text/html; charset=utf-8`,
                ``,
                htmlContent
            ].join('\n');

            const base64EncodedEmail = Buffer.from(emailContent).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

            const res = await transport.users.messages.send({
                userId: 'me',
                requestBody: {
                    raw: base64EncodedEmail,
                },
            });
            log(`Email sent to ${to}: ${res.data.id}`, 'info');
            return res.data;
        } catch (error) {
            log(`Error sending email to ${to}:`, 'error', null, error, 'error');
            throw error;
        }
    }
}

export {emailService};