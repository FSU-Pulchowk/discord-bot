import { promises as fs } from 'node:fs';
import readline from 'node:readline';
import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/calendar.readonly']; 
const TOKEN_PATH = 'token.json';
const CREDENTIALS_PATH = 'credentials.json';

/**
 * Main function to start the token generation process.
 */
async function main() {
    try {
        const content = await fs.readFile(CREDENTIALS_PATH, 'utf8');
        const credentials = JSON.parse(content);
        await authorize(credentials);
    } catch (err) {
        console.error(`Error loading ${CREDENTIALS_PATH}:`, err.message);
        console.error('Please ensure you have a valid credentials.json file in the root directory.');
        process.exit(1);
    }
}

/**
 * Authorize a client with credentials and then call the Google APIs.
 * @param {object} credentials The authorization client credentials.
 */
async function authorize(credentials) {
    const { client_secret, client_id, redirect_uris } = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(
        client_id, client_secret, redirect_uris[0]
    );

    try {
        const token = await fs.readFile(TOKEN_PATH, 'utf8');
        oAuth2Client.setCredentials(JSON.parse(token));
        console.log('✅ Existing token loaded from token.json.');
        console.log('Your REFRESH_TOKEN is:', JSON.parse(token).refresh_token);
        return;
    } catch (err) {
        console.log('No existing token found. Generating a new one...');
    }

    await getAccessToken(oAuth2Client);
}

/**
 * Get and store new token after prompting for user authorization, and print the refresh token.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 */
async function getAccessToken(oAuth2Client) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline', 
        scope: SCOPES,
        prompt: 'consent' 
    });

    console.log('\nAuthorize this app by visiting this URL:\n', authUrl);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const code = await new Promise(resolve => {
        rl.question('\nPaste the authorization code from that page here: ', resolve);
    });
    rl.close();

    try {
        const { tokens } = await oAuth2Client.getToken(code);
        await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens));
        console.log('\n✅ Token stored to', TOKEN_PATH);
        console.log('\nYour REFRESH_TOKEN (add this to your .env file):');
        console.log(tokens.refresh_token);
        console.log('\nMake sure to also set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI, and SENDER_EMAIL in your .env file.');
    } catch (err) {
        console.error('Error retrieving access token:', err.message);
        console.error('Please ensure the authorization code is correct and has not expired.');
        process.exit(1);
    }
}

main();