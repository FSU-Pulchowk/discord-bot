# Pulchowk Discord Bot

A versatile Discord bot designed for the Pulchowk Campus (FSU) community, featuring email verification, administrative tools, community engagement features, club & event management, and academic information.

## ✨ Features

This bot offers a wide range of functionalities to manage and enhance the Discord server:

**Verification & Onboarding:**

- **Email Verification (`/verify`, `/confirmotp`):** Verifies users using their official Pulchowk Campus email (`@pcampus.edu.np`) by sending a one-time password (OTP) via Gmail API.
- **Welcome Messages (`/setwelcome`):** Configurable welcome messages for new members, sent to a channel or via DM.
- **Remind Verify (`/remindverify`):** Sends a DM reminder to unverified members to complete verification.

**Moderation & Administration:**

- **Anti-Spam System (`/setantispam`, `/viewantispam`):** Automatically detects and takes action (mute, kick, ban) against spamming users based on configurable thresholds, including content-based detection.
- **Warnings (`/warn`):** Records warnings for users in the database, with a confirmation box before execution and an option to reset warnings.
- **Kick (`/kick`):** Kicks a user from the server.
- **Ban (`/ban`):** Bans a user from the server.
- **Timeout (`/timeout`):** Temporarily mutes a user.
- **Clean (`/clean`):** Bulk-deletes messages in a channel within a specified time frame.
- **Setup FSU (`/setupfsu`):** Creates a basic set of FSU-related roles, categories, and channels for quick server setup.
- **Admin Tasks (`/addtask`, `/listtasks`, `/completetask`):** Manage administrative to-do items.
- **Verified Users List (`/gotverified`):** Displays a list of verified users with their real names and college email addresses (Admin/Moderator only).
- **Role Protection:** Automatically prevents unauthorized deletion or modification of privileged roles by non-admins.

**Community Engagement & Information:**

- **Leveling/XP System:** Awards experience points (XP) for messages sent and voice chat activity, allowing users to level up and gain recognition.
- **Reputation System (`/repu`):** Allows moderators/admins to award reputation points to users (24-hour cooldown).
- **Suggestions (`/suggest`, `/approvesuggestion`, `/denysuggestion`, `/listsuggestions`):** Allows members to submit suggestions and administrators to review them.
- **Reaction Roles (`/setreactionrole`, `/removereactionrole`):** Enables users to assign themselves roles by reacting to specific messages.
- **FAQs (`/addfaq`, `/getfaq`, `/removefaq`):** Create and retrieve frequently asked questions.
- **User Stats (`/mystats`, `/topchatters`, `/topvoice`):** Tracks user activity (messages sent, voice chat time) and displays leaderboards.
- **Birthday Announcements (`/setbirthday`, `/removebirthday`):** Announces birthdays of members who have set their birthday.
- **Important Links (`/links`):** Provides quick access to relevant Pulchowk Campus and FSU links.
- **News/Notices (`/news`, `/checknotices`):** Provides links to official campus news and notice boards, scrapes latest notices automatically, and supports manual notice checks (Admin only).
- **Holidays (`/holidays`):** Displays upcoming holidays fetched from Google Calendar.

**Role Management:**

- **Assign Role (`/assignrole`):** Assigns a specified role to a user.
- **Remove Role (`/removerole`):** Removes a specified role from a user.
- **List All Roles (`/allroles`):** Lists all roles in the server with their IDs.
- **List User Roles (`/roles`):** Lists roles of a specified user or self.
- **Ping Intersection (`/pingintersect`):** Pings only members who hold **all** of the specified roles (intersection of up to 10 roles). Admin-only.

**Club & Event Management:**

- **Register Club (`/registerclub`):** Registers a new college club (verified members only, requires moderator/admin approval).
- **Browse Clubs (`/clubs browse`, `/clubs info`, `/clubs myclubs`, `/clubs events`, etc.):** Explore clubs by category, view details, manage memberships, and see upcoming events.
- **Create Event (`/createevent`):** Multi-step workflow for creating club events with poster upload, payment settings, and visibility options (public, Pulchowkian-only, or private/club-only).
- **Club Moderators (`/clubmod add`, `/clubmod remove`, `/clubmod list`):** Manage club moderators (President only).
- **Club Members (`/clubmember remove`, `/clubmember list`, `/clubmember info`):** Manage club member roster (Moderators/Presidents).
- **Transfer Presidency (`/transferpresident`):** Transfer club presidency to another verified club member, with confirmation flow.
- **Trusted Members (`/managetrusted add`, `/managetrusted remove`, `/managetrusted list`):** Manage trusted members within a club.
- **Announcements (`/announce`):** Post announcements to your club channel or a public channel (with optional webhook support).
- **Export Event (`/exportevent`):** Export event participant data (including payment status and proofs) to an Excel file.
- **Club Audit Log (`/clubaudit`):** View an audit log of club actions (moderation changes, announcements, approvals, etc.). Admin only.
- **Fix Club Permissions (`/fixclubperms`):** Repairs Discord channel permissions for club channels. Admin only.

## 📂 Project Structure

```
├── .dockerignore
├── .env.example
├── .github
│   └── workflows
│       ├── build-docker-image.yml
│       ├── codeql.yml
│       └── summary.yml
├── Dockerfile
├── Docs
│   ├── CLUB_AND_EVENT_MANAGEMENT.md
│   ├── Club_Management.md
│   ├── Email_Notifications.md
│   ├── Event_Management.md
│   ├── Payment_Details.md
│   ├── Payment_Verification.md
│   ├── Permission_System.md
│   ├── Setup_Guide.md
│   └── Troubleshooting.md
├── LICENSE
├── README.md
├── deploy-commands.js
├── docker-compose.yml
├── generateToken.js
├── package-lock.json
├── package.json
├── resetclubs.js
├── resetevents.js
└── src
    ├── bot.js
    ├── commands
    │   └── slash
    │       ├── addFaq.js
    │       ├── allRoles.js
    │       ├── announce.js
    │       ├── approveSuggestion.js
    │       ├── assignRole.js
    │       ├── ban.js
    │       ├── checknotice.js
    │       ├── clean.js
    │       ├── clubaudit.js
    │       ├── clubmember.js
    │       ├── clubmod.js
    │       ├── clubs.js
    │       ├── confirmotp.js
    │       ├── createEvent.js
    │       ├── denySuggestion.js
    │       ├── exportevent.js
    │       ├── fixclubperms.js
    │       ├── getFaq.js
    │       ├── gotVerified.js
    │       ├── help.js
    │       ├── holidays.js
    │       ├── kick.js
    │       ├── links.js
    │       ├── listSuggestions.js
    │       ├── managetrusted.js
    │       ├── myStats.js
    │       ├── news.js
    │       ├── pingintersect.js
    │       ├── registerclub.js
    │       ├── remindVerify.js
    │       ├── removeBirthday.js
    │       ├── removeFaq.js
    │       ├── removeReactionRole.js
    │       ├── removeRole.js
    │       ├── repu.js
    │       ├── roles.js
    │       ├── setAntiSpam.js
    │       ├── setBirthday.js
    │       ├── setReactionRole.js
    │       ├── setWelcome.js
    │       ├── setupFSU.js
    │       ├── suggest.js
    │       ├── tasks.js
    │       ├── timeout.js
    │       ├── topChatters.js
    │       ├── topVoice.js
    │       ├── transferpresident.js
    │       ├── verify.js
    │       ├── viewAntiSpam.js
    │       └── warn.js
    ├── database.js
    ├── events
    │   ├── interactionCreate.js
    │   └── roleProtection.js
    ├── scripts
    │   ├── fix-club-members-schema.sql
    │   ├── fixClubMembersSchema.js
    │   └── fixClubModeratorRoles.js
    ├── services
    │   ├── clubAutomation.js
    │   ├── clubExcelService.js
    │   ├── emailService.js
    │   └── scraper.js
    └── utils
        ├── NoticeProcessor.js
        ├── channelManager.js
        ├── clubApprovalHandlers.js
        ├── clubButtonHandlers.js
        ├── clubPermissions.js
        ├── debug.js
        ├── eventHandlers.js
        ├── eventRegistration.js
        ├── excelExporter.js
        ├── nonVerifiedRegOtpHandlers.js
        ├── nonVerifiedRegistration.js
        ├── otpGenerator.js
        ├── roleSelector.js
        └── spamDetector.js
```

## 🚀 Getting Started

Follow these steps to get Pulchowk Discord Bot up and running.

### 1\. Discord Application Setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create a new application.
2. Navigate to **Bot** → copy your **Bot Token** (`BOT_TOKEN`).
3. Enable the **Server Members Intent** and **Message Content Intent** under **Bot → Privileged Gateway Intents**.
4. Navigate to **General Information** → copy your **Application ID** (`CLIENT_ID`).
5. Under **OAuth2 → URL Generator**, select `bot` and `applications.commands` scopes, then choose required bot permissions (Administrator recommended for full functionality).
6. Copy the generated URL, paste it into a browser, and invite the bot to your server.
7. **Create a "Verified" Role:**
    - In your Discord server, go to **Server Settings → Roles**.
    - Create a new role (e.g., "Pulchowkian") and copy its ID (`VERIFIED_ROLE_ID`).
    - Ensure this role is positioned **below** the bot's own role in the hierarchy so the bot can assign it.

### 2\. Google Cloud Project Setup (for Gmail & Calendar APIs)

This bot uses Google APIs for email verification and holiday announcements.

1.  **Create a Google Cloud Project:**
    - Go to the [Google Cloud Console](https://console.cloud.google.com/).
    - Create a new project or select an existing one.
2.  **Enable APIs:**
    - Navigate to **APIs & Services → Enabled APIs & Services**.
    - Click **+ ENABLE APIS AND SERVICES** and enable:
      - **Gmail API** (for sending OTP emails)
      - **Google Calendar API** (for `/holidays` command)
3.  **Create OAuth Consent Screen:**
    - Go to **APIs & Services → OAuth consent screen**.
    - Configure it (choose "External" for personal use, fill in required info).
    - Add `https://www.googleapis.com/auth/gmail.send` as a scope.
    - Add `https://www.googleapis.com/auth/calendar.readonly` as a scope.
    - Add your email as a test user.
4.  **Create OAuth 2.0 Client ID (for Gmail API):**
    - Go to **APIs & Services → Credentials**.
    - Click **+ CREATE CREDENTIALS** → **OAuth client ID** → select **Desktop app**.
    - Copy `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
    - **Generate Refresh Token:**
      - Go to [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground/).
      - Authorize the `https://www.googleapis.com/auth/gmail.send` scope.
      - Click **Authorize APIs**, sign in, then **Exchange authorization code for tokens**.
      - Copy the `Refresh Token` — this is `REFRESH_TOKEN`.
      - Set `REDIRECT_URI` to `https://developers.google.com/oauthplayground`.
    - Set `SENDER_EMAIL` to the email address you want OTPs sent from (must be a Google Workspace account).
5.  **Create Service Account Key (for Google Calendar API — optional but recommended):**
    - Go to **APIs & Services → Credentials**.
    - Click **+ CREATE CREDENTIALS → Service Account**.
    - After creation, click the service account email → **Keys** tab → **ADD KEY → Create new key → JSON**.
    - Download the JSON file, rename it to `service_account_key.json`, and place it in the **root directory** of the project.
    - Set `GOOGLE_SERVICE_ACCOUNT_KEY_PATH="./service_account_key.json"` in `.env`.
    - Set `GOOGLE_HOLIDAY_CALENDAR_ID` in `.env` (e.g., `en.nepali#holiday@group.v.calendar.google.com` for Nepal holidays).

### 3\. Environment Variables (`.env`)

Copy `.env.example` to `.env` in the root directory and fill in all values:

```env
# Discord Bot Token (from Discord Developer Portal -> Bot -> Token)
BOT_TOKEN="YOUR_DISCORD_BOT_TOKEN_HERE"
# Discord Application (Client) ID (from Discord Developer Portal -> General Information)
CLIENT_ID="YOUR_DISCORD_APPLICATION_CLIENT_ID_HERE"
# ID of the Guild (Server) where you want to test/deploy commands
GUILD_ID="YOUR_DISCORD_GUILD_ID_HERE"
# ID of the role to assign on successful verification (right-click role -> Copy ID)
VERIFIED_ROLE_ID="YOUR_VERIFIED_ROLE_ID_HERE"

# --- Google Cloud Project Credentials for Gmail API ---
GOOGLE_CLIENT_ID="YOUR_GOOGLE_CLIENT_ID_HERE"
GOOGLE_CLIENT_SECRET="YOUR_GOOGLE_CLIENT_SECRET_HERE"
REDIRECT_URI="https://developers.google.com/oauthplayground"
REFRESH_TOKEN="YOUR_GOOGLE_REFRESH_TOKEN_HERE"
# The email address from your college Workspace that will send the OTP emails
SENDER_EMAIL="your-college-email@pcampus.edu.np"

# College email domain used for verification
COLLEGE_EMAIL_DOMAIN=pcampus.edu.np

# --- Google Calendar API (for /holidays command) ---
GOOGLE_SERVICE_ACCOUNT_KEY_PATH="./service_account_key.json"
GOOGLE_HOLIDAY_CALENDAR_ID="en.nepali#holiday@group.v.calendar.google.com"

# Optional: provide service account JSON as base64 (bot decodes it to src/service_account_key.json on startup)
GOOGLE_SERVICE_ACCOUNT_KEY_B64=""

# --- Notice Scraper Configuration ---
TARGET_NOTICE_CHANNEL_ID="YOUR_NOTICE_CHANNEL_ID_HERE"
NOTICE_ADMIN_CHANNEL_ID="YOUR_NOTICE_ADMIN_CHANNEL_ID_HERE"
NOTICE_CHECK_INTERVAL_MS=1800000

# --- Suggestions Feature Configuration ---
SUGGESTIONS_CHANNEL_ID="YOUR_SUGGESTIONS_CHANNEL_ID_HERE"

# --- Birthday Announcements Configuration ---
BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID="YOUR_BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID_HERE"

# --- Bot Prefix (for legacy prefix commands, e.g., !help) ---
BOT_PREFIX="!"

# --- Important Role IDs (FSU server-specific) ---
ADMIN_ROLE_ID="YOUR_ADMIN_ROLE_ID_HERE"
MODERATOR_ROLE_ID="YOUR_MODERATOR_ROLE_ID_HERE"
FSU_EXECUTIVE_ROLE_ID="YOUR_FSU_EXECUTIVE_ROLE_ID_HERE"
FSU_BOT_ROLE_ID="YOUR_FSU_BOT_ROLE_ID_HERE"
CLUB_PRESIDENT_ROLE_ID="YOUR_CLUB_PRESIDENT_ROLE_ID_HERE"
LIGHT_BAN_ROLE_ID="YOUR_LIGHT_BAN_ROLE_ID"

# --- Club & Event Management ---
# Channel where public (server-wide) events will be posted
PUBLIC_EVENTS_CHANNEL_ID="YOUR_PUBLIC_EVENTS_CHANNEL_ID_HERE"
# Channel where Pulchowkian-only (verified members) events will be posted
PULCHOWKIAN_EVENTS_CHANNEL_ID="YOUR_EVENTS_CHANNEL_ID_HERE"
# Channel where event approval requests are sent (for clubs requiring approval)
EVENT_APPROVAL_CHANNEL_ID="YOUR_EVENT_APPROVAL_CHANNEL_ID_HERE"
```

### 4\. Installation

Open a terminal in the project root and run:

```bash
npm install
```

### 5\. Deploying Slash Commands

Slash commands must be registered with Discord before use. Deploy them to a specific guild for testing, or globally for production.

- **For testing (recommended):**
  ```bash
  node deploy-commands.js --guild
  # or via npm script:
  npm run deploy-commands-guild
  ```
- **For global deployment (production):** This can take up to an hour to propagate.
  ```bash
  node deploy-commands.js --global
  # or via npm script:
  npm run deploy-commands-global
  ```

### 6\. Running the Bot

The bot is managed with **PM2** for process persistence and automatic restarts.

```bash
# Start the bot (via PM2)
npm start

# View live logs
npm run log

# Restart the bot
npm run restart

# Check PM2 status
npm run status

# Stop the bot
npm run kill
```

For quick debugging without PM2:

```bash
npm run start:debug
```

## Usage

### Commands

| Command | Description | Example Usage |
| :--- | :--- | :--- |
| `/help [command_name]` | Displays a list of all commands or detailed info about one. | `/help` |
| `/verify` | Initiates the email verification process. | `/verify` |
| `/confirmotp <code>` | Confirms the verification with the OTP sent to your email. | `/confirmotp 123456` |
| `/remindverify` | Sends a DM reminder to an unverified member to complete verification. | `/remindverify @User` |
| `/news` | Shows the latest notices scraped from the Pulchowk Campus website. | `/news` |
| `/checknotices` | Manually triggers a notice check (Admin only). | `/checknotices` |
| `/holidays` | Displays upcoming holidays fetched from Google Calendar. | `/holidays` |
| `/links` | Displays important Pulchowk Campus/FSU-related links. | `/links` |
| `/addfaq "Question" "Answer"` | Adds a new FAQ entry. | `/addfaq "What is FSU?" "Future Skills University"` |
| `/getfaq <ID or keyword>` | Retrieves an FAQ by ID or keyword search. | `/getfaq "What is FSU?"` |
| `/removefaq <ID>` | Removes an existing FAQ entry. | `/removefaq 123` |
| `/addtask <description>` | Adds a new administrative task. | `/addtask "Study for exam"` |
| `/listtasks [status]` | Lists pending, completed, or all administrative tasks. | `/listtasks` |
| `/completetask <ID>` | Marks an administrative task as complete. | `/completetask 1` |
| `/suggest <suggestion>` | Submits a suggestion to the server staff. | `/suggest "Add more channels"` |
| `/listsuggestions [status]` | Lists all suggestions (Moderator). | `/listsuggestions` |
| `/approvesuggestion <ID> [reason]` | Approves a suggestion (Moderator). | `/approvesuggestion 1` |
| `/denysuggestion <ID> [reason]` | Denies a suggestion (Moderator). | `/denysuggestion 1` |
| `/mystats` | Shows your personal chat and voice activity. | `/mystats` |
| `/topchatters [limit]` | Displays the top chatters in the server. | `/topchatters 10` |
| `/topvoice [limit]` | Displays the top voice activity users in the server. | `/topvoice 5` |
| `/repu @user` | Awards 1 reputation point to a user (Moderator/Admin, 24h cooldown). | `/repu @User` |
| `/setbirthday <MM/DD>` | Sets your birthday for announcements. | `/setbirthday 01/15` |
| `/removebirthday` | Removes your saved birthday. | `/removebirthday` |
| `/assignrole @user <RoleNameOrID>` | Assigns a role to a user (Moderator). | `/assignrole @User Member` |
| `/removerole @user <RoleNameOrID>` | Removes a role from a user (Moderator). | `/removerole @User Member` |
| `/allroles` | Lists all available roles on the server. | `/allroles` |
| `/roles [@user]` | Lists roles of a specified user or yourself. | `/roles @User` |
| `/setreactionrole <messageId> <emoji> <RoleNameOrID>` | Sets up a reaction role on a message. | `/setreactionrole 1234567890 🍎 9876543210` |
| `/removereactionrole <messageId> <emoji>` | Removes a reaction role from a message. | `/removereactionrole 1234567890 🍎` |
| `/setwelcome "message"` | Sets the welcome message for new members (`{user}` as placeholder). | `/setwelcome "Welcome {user}!"` |
| `/setwelcome disable` | Disables the welcome message. | `/setwelcome disable` |
| `/ban @user [reason]` | Bans a user from the server (Moderator). | `/ban @User Spamming` |
| `/kick @user [reason]` | Kicks a user from the server (Moderator). | `/kick @User Rule violation` |
| `/timeout @user <duration> [reason]` | Times out a user (Moderator). | `/timeout @User 5m Misbehaving` |
| `/warn @user [reason]` | Issues a warning to a user (Moderator). | `/warn @User Off-topic` |
| `/clean <duration>` | Bulk-deletes messages within a time frame (e.g., `1h`, `30m`). | `/clean 1h` |
| `/setantispam [setting <value>]` | Configures anti-spam settings (Admin). | `/setantispam message_limit 7 time_window_seconds 10` |
| `/viewantispam` | Views current anti-spam settings (Admin). | `/viewantispam` |
| `/gotverified` | Displays verified users with real names and emails (Admin/Moderator). | `/gotverified` |
| `/setupfsu` | Creates FSU-related roles, categories, and channels (Admin). | `/setupfsu` |
| `/pingintersect <role_1> <role_2> [...]` | Pings members who hold **all** specified roles (Admin, up to 10 roles). | `/pingintersect @RoleA @RoleB` |

**Club & Event Commands:**

| Command | Description |
| :--- | :--- |
| `/registerclub` | Register a new club (verified member only; requires moderator/admin approval). |
| `/clubs browse [category]` | Browse all clubs, optionally filtered by category. |
| `/clubs info <club_name>` | Get detailed information about a specific club. |
| `/clubs myclubs` | View your own club memberships. |
| `/clubs events [club_name]` | View upcoming events, optionally for a specific club. |
| `/createevent <club> [visibility]` | Create a new club event with poster, payment options, and visibility settings. |
| `/announce <club>` | Post an announcement to your club channel or a public channel. |
| `/exportevent <event_id>` | Export event participant data to an Excel file (Club Moderator). |
| `/clubmod add/remove/list <club>` | Manage club moderators (Club President only). |
| `/clubmember remove/list/info <club>` | Manage club members (Club Moderators/Presidents). |
| `/managetrusted add/remove/list <club_id>` | Manage trusted members of a club (Club Moderator). |
| `/transferpresident <club> <new_president> <reason>` | Transfer club presidency to another verified member. |
| `/clubaudit [club] [action] [limit]` | View club audit log (Admin). |
| `/fixclubperms [club]` | Fix Discord channel permissions for club channels (Admin). |

## 📚 Documentation

Detailed guides for the Club & Event Management system:

- **[Club & Event Management Overview](Docs/CLUB_AND_EVENT_MANAGEMENT.md)**: High-level overview of the club and event system.
- **[Club Management](Docs/Club_Management.md)**: Registration, settings, member management, and leadership transfer.
- **[Event Management](Docs/Event_Management.md)**: Creating events, visibility settings, and approval workflows.
- **[Payment Details](Docs/Payment_Details.md)**: Paid event configuration and payment collection flows.
- **[Payment Verification](Docs/Payment_Verification.md)**: Handling paid events, valid proof uploads, and verifying payments.
- **[Permission System](Docs/Permission_System.md)**: Role hierarchy and permission checks for club/event operations.
- **[Email Notifications](Docs/Email_Notifications.md)**: Triggers and configuration for email alerts.
- **[Setup Guide](Docs/Setup_Guide.md)**: Step-by-step initial setup guide for the bot.
- **[Troubleshooting](Docs/Troubleshooting.md)**: Common errors and solutions.

### Key Features Overview

- **Club registration**: Clubs are created via `/registerclub` and may require admin approval before becoming active.
- **Event creation**: `/createevent` triggers a multi-step workflow covering event details, payment settings (free or paid), and poster uploads.
- **Payment System**: Built-in verification loop for paid events — participants submit payment proofs via DM, which are reviewed by club moderators.
- **Non-verified registration**: Non-verified users can register for public events via an OTP email flow.
- **Automation**: Scheduled notice scraping, birthday announcements, and club automation services run in the background.

## Google Service Account (two options)

The bot can access Google Calendar using a service account JSON file or a base64-encoded environment variable. The latter is useful for CI/CD pipelines or deployments where secret files are inconvenient.

- **File approach:** Set `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` to the JSON file path (commonly `./service_account_key.json`).
- **Base64 env approach:** Set `GOOGLE_SERVICE_ACCOUNT_KEY_B64` to the base64-encoded contents of the service account JSON. On startup, `src/bot.js` will decode it and write `src/service_account_key.json` automatically.

To generate a base64 string locally (Linux/macOS):

```bash
base64 -w0 service_account_key.json > sa_key.b64
# Copy the content of sa_key.b64 into env var GOOGLE_SERVICE_ACCOUNT_KEY_B64
```

> **Security note:** Do **NOT** commit `service_account_key.json` or the base64 string to version control. Use secret management in your deployment platform.

## Developer Reference (quick map)

- `src/bot.js` — Main bot entry point. Initializes client, loads commands, registers event handlers, starts scheduled tasks, and sets up integrations (email, notice scraper, club automation).
- `src/database.js` — SQLite initialization and migration logic (creates all tables used by the bot).
- `src/commands/slash/` — One file per slash command.
- `src/events/` — Discord event handlers (`interactionCreate.js` dispatches commands/modals/buttons; `roleProtection.js` guards privileged roles).
- `src/services/` — Background services:
  - `emailService.js` — Gmail API wrapper for sending OTP and notification emails.
  - `scraper.js` — Scrapes Pulchowk Campus notice boards.
  - `clubAutomation.js` — Scheduled club automation tasks.
  - `clubExcelService.js` — Excel export service for club/event data.
- `src/utils/` — Utility modules:
  - `debug.js` — Structured logging helper.
  - `otpGenerator.js` — OTP generation.
  - `NoticeProcessor.js` — Processes and announces scraped notices to the configured channel.
  - `clubPermissions.js` — Club permission checks and role helpers.
  - `clubApprovalHandlers.js` / `clubButtonHandlers.js` — Button interaction handlers for club approval workflows.
  - `eventHandlers.js` / `eventRegistration.js` — Event creation and registration flows.
  - `nonVerifiedRegistration.js` / `nonVerifiedRegOtpHandlers.js` — OTP-based event registration for non-verified users.
  - `excelExporter.js` — Generates Excel exports for event participants.
  - `channelManager.js` — Manages channel posting for events.
  - `roleSelector.js` — Role selection UI helpers.
  - `spamDetector.js` — Anti-spam detection logic.
- `src/scripts/` — One-off migration/fix scripts (not part of normal bot runtime).

## Operations Checklist

- Back up `bot.db` regularly. The file is created at the repository root as `bot.db` by default.
- If using Docker or Render, ensure persistent storage for `bot.db` (bind mount or persistent disk).
- Store `service_account_key.json` and other credentials as secrets in your deployment platform, or provide `GOOGLE_SERVICE_ACCOUNT_KEY_B64` as a protected env var.
- To redeploy commands after adding or changing a command file, run:

```bash
npm run deploy-commands-guild   # for testing in a guild
npm run deploy-commands-global  # for global deployment
```

## Deploying on Render

**Important Note on Database Persistence:** The bot uses SQLite (`bot.db`) for data storage. Render's standard web services use ephemeral storage, so `bot.db` **will be lost** on redeploys or restarts unless you configure a persistent disk.

### Steps to Deploy on Render:

1.  **Push Code to a Git Repository:**
    - Commit and push all bot files to GitHub, GitLab, or Bitbucket.
    - Add `bot.db` and `service_account_key.json` to `.gitignore` if your repository is public.

2.  **Create a Render Account:** Sign up at [Render.com](https://render.com/).

3.  **Create a New Web Service:**
    - From the Render Dashboard, click **New → Web Service**.
    - Connect your Git repository and click **Connect**.

4.  **Configure the Web Service:**
    - **Runtime:** `Node`
    - **Build Command:** `npm install`
    - **Start Command:** `node src/bot.js`
    - **Instance Type:** Paid tier recommended for 24/7 uptime (free instances spin down after inactivity).

5.  **Add Environment Variables:**
    - Add all key-value pairs from your local `.env` file.
    - For the service account key, use the **Secret File** approach or the `GOOGLE_SERVICE_ACCOUNT_KEY_B64` environment variable.

6.  **Add Secret File for `service_account_key.json`:**
    - In **Environment Variables**, click **Add Secret File**.
    - **Filename:** `service_account_key.json`
    - **Content:** Paste the full JSON content of your service account key.

7.  **Configure Persistent Disk (Crucial for SQLite):**
    - Under **Disks**, click **Add Disk**.
    - **Mount Path:** `/opt/render/project/bot.db`
    - **Size:** 1 GB (SQLite databases are small).

8.  **Create Web Service** and monitor the deployment logs.

### After Deployment:

- Verify the bot appears online in your Discord server.
- Test commands like `/verify` and `/mystats`.
- Manually restart the Render service and confirm data (e.g., `/listsuggestions`) still persists — this confirms the persistent disk is working.

**Troubleshooting Tips for Render:**

- **"Web service failed to start"**: Check that the Start Command is `node src/bot.js` and `package.json` `main` field is correct.
- **"Cannot find module"**: Ensure all dependencies are in `package.json` and `npm install` ran successfully.
- **Bot goes offline**: Upgrade to a paid instance for 24/7 uptime.
- **Google API errors**: Double-check all Google API environment variables and the `service_account_key.json` content.
- **Permission errors**: Verify bot permissions in the Discord Developer Portal and role hierarchy in the server.

## Hosting Locally with Docker

### 1. Prerequisites

- Docker Desktop (or Docker Engine for Linux) installed and running.

### 2. Project Setup

- Ensure `Dockerfile` and `docker-compose.yml` are in the project root.
- Create a `.env` file with all required environment variables (see [Environment Variables](#3-environment-variables-env) above).
- If using Google Calendar, place `service_account_key.json` in the project root.

### 3. Deploy Slash Commands (One-Time Setup)

Before running the bot with Docker, register slash commands locally:

```bash
npm install
node deploy-commands.js --guild   # or --global
```

### 4. Build and Run with Docker Compose

```bash
# Build the Docker image
docker-compose build

# Start the bot in detached mode
docker-compose up -d
```

### 5. Verify and Manage

```bash
# Check container status
docker-compose ps

# View logs
docker-compose logs fsu-discord-bot

# Stop the bot
docker-compose down

# Stop and remove volumes (caution: deletes fsu_data volume)
docker-compose down --volumes
```

### Dockerfile & docker-compose.yml Notes

- **`Dockerfile`**: Uses `node:20-slim` as the base image. Creates a non-root `botuser` for security, installs only production dependencies (`npm ci --omit=dev`), and runs `node ./src/bot.js` on startup.
- **`docker-compose.yml`**: Mounts `./bot.db:/app/bot.db` for SQLite persistence, uses a named `fsu_data` volume for additional data, mounts a `tmpfs` at `/tmp`, and configures `restart: unless-stopped` for automatic recovery.

**Important Considerations:**

- Ensure your firewall allows outgoing connections to Discord and Google APIs.
- The `database.js` module creates `bot.db` automatically on first run.
- To update the bot after code changes, rebuild the image:
  ```bash
  docker-compose build && docker-compose up -d
  ```

## 🤝 Contributing

Contributions are welcome! If you have suggestions for improvements or new features, feel free to open an issue or submit a pull request.

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/AmazingFeature`.
3. Commit your changes: `git commit -m 'Add some AmazingFeature'`.
4. Push to the branch: `git push origin feature/AmazingFeature`.
5. Open a Pull Request.

## 📄 License

This project is licensed under the [No Redistribution License](LICENSE).
