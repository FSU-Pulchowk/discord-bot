import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

class EmailService {
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
            console.error("Missing one or more Google API environment variables. Please check your .env file.");
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
            if (!accessToken) {
                throw new Error('Failed to obtain Google API access token.');
            }

            const gmail = google.gmail({ version: 'v1', auth: this.oAuth2Client });

            const message = [
                `To: ${to}`,
                `Subject: ${subject}`,
                'MIME-Version: 1.0',
                'Content-Type: text/html; charset="UTF-8"', 
                '',
                htmlContent,
            ].join('\n');

            const encodedMessage = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

            const res = await gmail.users.messages.send({
                userId: this.senderEmail,
                requestBody: {
                    raw: encodedMessage,
                },
            });
            return res.data;
        } catch (error) {
            console.error('Error sending email:', error.message);
            if (error.code === 401) {
                console.error('Possible reason: Refresh token expired or invalid. Try regenerating it in OAuth Playground.');
            }
            throw error;
        }
    }
}

const emailService = new EmailService();
export { emailService };