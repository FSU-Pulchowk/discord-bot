# Pulchowk Discord Bot

![Discord Bot Logo/Banner](https://img.shields.io/badge/Discord%20Bot-Online-brightgreen?style=for-the-badge&logo=discord)
![Node.js Version](https://img.shields.io/badge/Node.js-16%2B-blue?style=for-the-badge&logo=node.js)

A versatile Discord bot designed for the Pulchowk Campus community, featuring email verification, administrative tools, community engagement features, and academic information.

## ✨ Features

This bot offers a wide range of functionalities to manage and enhance  Discord server:

**Verification & Onboarding:**
- **Email Verification (`/verify`, `/confirmotp`):** Verifies users using their official Pulchowk Campus email by sending a one-time password (OTP).
- **Welcome Messages:** Configurable welcome messages for new members, sent to a channel or via DM.

**Moderation & Administration:**
- **Anti-Spam System:** Automatically detects and takes action (mute, kick, ban) against spamming users based on configurable thresholds.
- **Warnings (`!warn`):** Records warnings for users in the database.
- **Kick (`!kick`):** Kicks a user from the server.
- **Ban (`!ban`):** Bans a user from the server.
- **Timeout (`!timeout`):** Temporarily mutes a user.
- **Nuke (`!nuke`):** (Extreme caution!) Deletes all channels and roles in the server (except the command channel).
- **Setup FSU (`!setupfsu`):** Creates a basic set of FSU-related roles, categories, and channels for quick server setup.
- **Admin Tasks (`!addtask`, `!listtasks`, `!completetask`):** Manage administrative to-do items.
- **Verified Users List (`!gotverified`):** Displays a list of verified users with their real names and college email addresses (Admin/Moderator only).

**Community Engagement & Information:**
- **Suggestions (`!suggest`, `!approvesuggestion`, `!denysuggestion`, `!listsuggestions`):** Allows members to submit suggestions and administrators to review them.
- **Reaction Roles (`!setreactionrole`, `!removereactionrole`):** Enables users to assign themselves roles by reacting to specific messages.
- **FAQs (`!addfaq`, `!getfaq`, `!removefaq`):** Create and retrieve frequently asked questions.
- **User Stats (`!mystats`, `!topchatters`, `!topvoice`):** Tracks user activity (messages sent, voice chat time) and displays leaderboards.
- **Birthday Announcements:** Announces birthdays of members who have set their birthday.
- **Important Links (`!links`):** Provides quick access to relevant Pulchowk Campus and FSU links.
- **News/Notices (`!news`):** Provides links to official campus news and notice boards, and scrapes latest notices.
- **Holidays (`!holidays`):** Displays upcoming holidays fetched from Google Calendar.

**Role Management:**
- **Assign Role (`!assignrole`):** Assigns a specified role to a user.
- **Remove Role (`!removerole`):** Removes a specified role from a user.
- **List All Roles (`!allroles`):** Lists all roles in the server with their IDs.
- **List User Roles (`!roles`):** Lists roles of a specified user or self.

## 📂 Project Structure

```

.
├── .env                  (Environment variables for configuration)
├── package.json          (Project metadata and dependencies)
├── deploy-commands.js    (Script to register Discord slash commands)
├── test-scraper.js       (Utility to test the web scraping logic)
└── src/                  (Main source code directory)
├── bot.js            (Main bot file: initializes client, loads commands, sets up events, schedules scraper)
├── database.js       (Handles SQLite DB connection and table creation)
├── services/         (External service integrations)
│   ├── emailService.js   (Google Gmail API integration for OTP)
│   └── scraper.js        (Core web scraping logic for FSU notices/holidays)
├── commands/         (Bot commands, categorized by type)
│   ├── slash/            (For Discord Slash Commands)
│   │   ├── verify.js
│   │   └── confirmotp.js
│   └── prefix/           (For traditional Prefix Commands)
│       ├── addFaq.js
│       ├── addTask.js
│       ├── allRoles.js
│       ├── approveSuggestion.js
│       ├── assignRole.js
│       ├── ban.js
│       ├── completeTask.js
│       ├── denySuggestion.js
│       ├── getFaq.js
│       ├── gotVerified.js  (New command file)
│       ├── help.js         (Modified for updated command lists and structure)
│       ├── holidays.js
│       ├── kick.js
│       ├── links.js
│       ├── listSuggestions.js
│       ├── listTasks.js
│       ├── myStats.js
│       ├── news.js
│       ├── nuke.js
│       ├── removeBirthday.js
│       ├── removeFaq.js
│       ├── removeReactionRole.js
│       ├── removeRole.js
│       ├── roles.js
│       ├── setAntiSpam.js
│       ├── setBirthday.js
│       ├── setReactionRole.js
│       ├── setupFSU.js
│       ├── setWelcome.js
│       ├── suggest.js
│       ├── timeout.js
│       ├── topChatters.js
│       ├── topVoice.js
│       ├── viewAntiSpam.js
│       └── warn.js
└── utils/
├── Command.js             (Base class for prefix commands)
├── CommandHandler.js      (Manages prefix command execution, includes verified role check)
└── otpGenerator.js        (Utility for generating One-Time Passwords)

````

## 🚀 Getting Started

Follow these steps to get  Pulchowk Discord Bot up and running.

### Prerequisites

* [Node.js](https://nodejs.org/en/) (v16.x or higher recommended)
* [npm](https://www.npmjs.com/) (comes with Node.js)
* A [Discord Account](https://discord.com/)
* A [Google Cloud Account](https://cloud.google.com/)

### Installation

1.  **Clone the repository:**
    ```bash
    git clone [https://github.com/-username/pulchowk-discord-bot.git](https://github.com/-username/pulchowk-discord-bot.git)
    cd pulchowk-discord-bot
    ```
    *(Replace `-username/pulchowk-discord-bot.git` with  actual repository URL)*

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Create a `.env` file:**
    Create a file named `.env` in the root directory of  project. This file will store sensitive information and configuration.

### 1. Discord Bot Setup

1.  **Create a Discord Application:**
    -   Go to the [Discord Developer Portal](https://discord.com/developers/applications).
    -   Click "New Application". Give it a name (e.g., "Pulchowk Bot").
2.  **Create a Bot User:**
    -   In  application, go to the "Bot" tab.
    -   Click "Add Bot" and confirm.
    -   **Reveal Token:** Click "Reset Token" and copy the token. This is  `BOT_TOKEN`. **Keep it secret!**
3.  **Enable Gateway Intents:**
    -   Under the "Bot" tab, scroll down to "Privileged Gateway Intents".
    -   Enable **PRESENCE INTENT**, **SERVER MEMBERS INTENT**, and **MESSAGE CONTENT INTENT**. These are crucial for the bot's functionality.
4.  **Get Client ID:**
    -   Go to the "General Information" tab. Copy the "Application ID". This is  `CLIENT_ID`.
5.  **Get Guild ID (for testing):**
    -   In  Discord server, enable "Developer Mode" (User Settings -> Advanced).
    -   Right-click on  server icon in Discord and select "Copy ID". This is  `GUILD_ID`.
6.  **Invite the Bot to  Server:**
    -   Go to the "OAuth2" -> "URL Generator" tab.
    -   Select `bot` and `applications.commands` scopes.
    -   Under "Bot Permissions", select the following:
        -   `Administrator` (simplest for full functionality, but grant specific permissions for production if you prefer)
        -   Alternatively, grant specific permissions: `Manage Roles`, `Kick Members`, `Ban Members`, `Moderate Members`, `Manage Channels`, `Read Messages/View Channels`, `Send Messages`, `Embed Links`, `Attach Files`, `Add Reactions`, `Use External Emojis`, `Read Message History`, `Connect`, `Speak`, `Mute Members`, `Deafen Members`, `Move Members`.
    -   Copy the generated URL and paste it into  browser to invite the bot.
7.  **Create a "Verified" Role:**
    -   In  Discord server, go to Server Settings -> Roles.
    -   Create a new role named "Verified" (or anything you prefer).
    -   **Copy its ID:** Right-click the role and select "Copy ID". This is  `VERIFIED_ROLE_ID`. Ensure this role is positioned **below**  bot's role in the server's role hierarchy so the bot can assign it.

### 2. Google Cloud Project Setup (for Gmail & Calendar APIs)

This bot uses Google APIs for email verification and holiday announcements.

1.  **Create a Google Cloud Project:**
    -   Go to the [Google Cloud Console](https://console.cloud.google.com/).
    -   Create a new project or select an existing one.
2.  **Enable APIs:**
    -   In  project, navigate to "APIs & Services" -> "Enabled APIs & Services".
    -   Click "+ ENABLE APIS AND SERVICES".
    -   Search for and enable:
        -   **Gmail API** (for sending OTP emails)
        -   **Google Calendar API** (for `!holidays` command)
3.  **Create OAuth Consent Screen:**
    -   Go to "APIs & Services" -> "OAuth consent screen".
    -   Configure it (choose "External" for personal use, fill in required info).
    -   Add `https://www.googleapis.com/auth/gmail.send` as a scope.
    -   Add `https://www.googleapis.com/auth/calendar.readonly` as a scope.
    -   Add  email as a test user.
4.  **Create OAuth 2.0 Client ID (for Gmail API):**
    -   Go to "APIs & Services" -> "Credentials".
    -   Click "+ CREATE CREDENTIALS" and choose "OAuth client ID".
    -   Select "Desktop app" as the application type.
    -   Copy  `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
    -   **Generate Refresh Token:**
        -   Go to [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground/).
        -   In the left pane, authorize the `https://www.googleapis.com/auth/gmail.send` scope and `https://www.googleapis.com/auth/calendar.readonly` scope.
        -   Click "Authorize APIs".
        -   Select  Google account and grant permissions.
        -   Click "Exchange authorization code for tokens".
        -   Copy the `Refresh Token`. This is  `REFRESH_TOKEN`.
        -   Set `REDIRECT_URI` in  `.env` to `https://developers.google.com/oauthplayground` (or  custom URI if you set one up).
    -   Set `SENDER_EMAIL` in  `.env` to the email address you want the OTPs to be sent from (must be associated with  Google Workspace account).
5.  **Create Service Account Key (for Google Calendar API - Optional but Recommended):**
    -   Go to "APIs & Services" -> "Credentials".
    -   Click "+ CREATE CREDENTIALS" and choose "Service Account".
    -   Follow the steps to create a new service account.
    -   Grant it the "Calendar Viewer" role (or a custom role with `calendar.events.list` permission).
    -   After creation, click on the service account email.
    -   Go to the "Keys" tab and click "ADD KEY" -> "Create new key".
    -   Select "JSON" and click "CREATE". A JSON file will download.
    -   **Rename this file to `service_account_key.json`** and place it in the **root directory of  bot project**.
    -   Set `GOOGLE_SERVICE_ACCOUNT_KEY_PATH="./service_account_key.json"` in  `.env`.
    -   Set `GOOGLE_HOLIDAY_CALENDAR_ID` in  `.env` (e.g., `'en.nepali#holiday@group.v.calendar.google.com'` for Nepal holidays).

### 3. Environment Variables (`.env`)

Create a file named `.env` in the root directory of  project and populate it with the values obtained from the previous steps.

```env
# Discord Bot Token (from Discord Developer Portal ->  Bot -> Token)
BOT_TOKEN="_DISCORD_BOT_TOKEN_HERE"
# Discord Application (Client) ID (from Discord Developer Portal -> General Information)
CLIENT_ID="_DISCORD_APPLICATION_CLIENT_ID_HERE"
# ID of the Guild (Server) where you want to test/deploy commands (right-click server -> Copy ID - Developer Mode must be enabled)
GUILD_ID="_DISCORD_GUILD_ID_HERE"
# ID of the role to assign on successful verification (right-click role -> Copy ID)
VERIFIED_ROLE_ID="_VERIFIED_ROLE_ID_HERE"

# --- Google Cloud Project Credentials for Gmail API ---
# GOOGLE_CLIENT_ID (from Google Cloud Console -> APIs & Services -> Credentials -> OAuth 2.0 Client IDs)
GOOGLE_CLIENT_ID="_GOOGLE_CLIENT_ID_HERE"
# GOOGLE_CLIENT_SECRET (from Google Cloud Console -> APIs & Services -> Credentials -> OAuth 2.0 Client IDs)
GOOGLE_CLIENT_SECRET="_GOOGLE_CLIENT_SECRET_HERE"
# Redirect URI used during OAuth2 consent screen setup (e.g., [https://developers.google.com/oauthplayground](https://developers.google.com/oauthplayground))
REDIRECT_URI="[https://developers.google.com/oauthplayground](https://developers.google.com/oauthplayground)" # Or  custom redirect URI
# Refresh Token generated from OAuth2 Playground with [https://www.googleapis.com/auth/gmail.send](https://www.googleapis.com/auth/gmail.send) scope
REFRESH_TOKEN="_GOOGLE_REFRESH_TOKEN_HERE"
# The email address from  college Workspace that will send the OTP emails
SENDER_EMAIL="-college-email@pulchowk.edu.np"

# --- Google Calendar API (for Holidays command) ---
# Path to  Google Service Account Key JSON file (e.g., ./service_account_key.json)
# If not using service account, leave blank or remove. Holidays command will be disabled.
GOOGLE_SERVICE_ACCOUNT_KEY_PATH="./service_account_key.json"
# Google Calendar ID for holidays (e.g., 'en.nepali#holiday@group.v.calendar.google.com' for Nepal holidays)
GOOGLE_HOLIDAY_CALENDAR_ID="en.nepali#holiday@group.v.calendar.google.com"

# --- Notice Scraper Configuration ---
# Channel ID where new notices will be posted
TARGET_NOTICE_CHANNEL_ID="_NOTICE_CHANNEL_ID_HERE"
# Channel ID for scraper error notifications (e.g., an admin channel)
NOTICE_ADMIN_CHANNEL_ID="_NOTICE_ADMIN_CHANNEL_ID_HERE"
# Interval for checking new notices in milliseconds (e.g., 30 minutes = 1800000)
NOTICE_CHECK_INTERVAL_MS=1800000

# --- Suggestions Feature Configuration ---
# Channel ID where suggestions will be posted and reacted to
SUGGESTIONS_CHANNEL_ID="_SUGGESTIONS_CHANNEL_ID_HERE"

# --- Birthday Announcements Configuration ---
# Channel ID where birthday announcements will be posted
BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID="_BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID_HERE"

# --- Bot Prefix for traditional commands (e.g., !help) ---
BOT_PREFIX="!"
````

### 4\. Installation

Open  terminal in the project's root directory and run:

```bash
npm install
```

### 5\. Deploying Slash Commands

Slash commands need to be registered with Discord. You can deploy them to a specific guild for testing or globally for production.

  - **For testing (recommended):** Deploy to  specific test guild.
    ```bash
    node deploy-commands.js --guild
    ```
  - **For global deployment (production):** This can take up to an hour to propagate.
    ```bash
    node deploy-commands.js --global
    ```

### 6\. Running the Bot

Once commands are deployed, you can start  bot:

```bash
npm start
```

## Usage

### Slash Commands

  - `/verify`: Initiates the email verification process.
  - `/confirmotp <code>`: Confirms the verification with a One-Time Password.

### Prefix Commands (Default prefix: `!`)

| Command           | Description                                                 | Example Usage              |
| :---------------- | :---------------------------------------------------------- | :------------------------- |
| `!help [command_name]` | Displays a list of all commands or detailed information.  | `!help`                    |
| `!news`           | Shows the latest notices scraped from the Pulchowk Campus website. | `!news`                    |
| `!holidays`       | Displays upcoming holidays fetched from Google Calendar.    | `!holidays`                |
| `!addfaq "Question" "Answer" [keywords]` | Adds a new FAQ entry.                   | `!addfaq "What is FSU?" "Future Skills University"` |
| `!getfaq <ID>` | Retrieves an FAQ by ID or searches by keywords.      | `!getfaq "What is FSU?"`   |
| `!removefaq <ID>` | Removes an existing FAQ entry.                              | `!removefaq 123`           |
| `!addtask <description>` | Adds a new administrative task.                      | `!addtask "Study for exam"`|
| `!listtasks [status]` | Lists pending, completed, or all administrative tasks.    | `!listtasks`               |
| `!completetask <ID>` | Marks an administrative task as complete.                 | `!completetask 1`          |
| `!suggest <suggestion>` | Submits a suggestion to the server staff.               | `!suggest "Add more channels"` |
| `!listsuggestions [status]` | Lists all pending suggestions (Moderator).          | `!listsuggestions`         |
| `!approvesuggestion <ID> [reason]` | Approves a suggestion (Moderator).       | `!approvesuggestion 1`     |
| `!denysuggestion <ID> [reason]` | Denies a suggestion (Moderator).             | `!denysuggestion 1`        |
| `!links`          | Displays important Pulchowk Campus/FSU-related links.       | `!links`                   |
| `!mystats`        | Shows  personal chat and voice activity.                | `!myStats`                 |
| `!topchatters [limit]` | Displays the top chatters in the server.                | `!topchatters 10`          |
| `!topvoice [limit]` | Displays the top voice activity users in the server.       | `!topvoice 5`              |
| `!setbirthday <MM/DD/YYYY>` | Sets  birthday for announcements.     | `!setbirthday 01/15`       |
| `!removebirthday` | Removes  saved birthday.                                | `!removebirthday`          |
| `!assignrole @user <RoleNameOrID>` | Assigns a role to a user (Moderator).    | `!assignrole @User Member` |
| `!removeRole @user <RoleNameOrID>` | Removes a role from a user (Moderator).  | `!removerole @User Member` |
| `!allroles`       | Lists all available roles on the server.                    | `!allroles`                |
| `!setreactionrole <messageId> <emoji> <RoleNameOrID>` | Sets up a reaction role message. | `!setreactionrole 1234567890 🍎 9876543210` |
| `!removereactionrole <messageId> <emoji>` | Removes a reaction role from a message. | `!removereactionrole 1234567890 🍎` |
| `!setwelcome "message"` | Sets the welcome message for new members.             | `!setwelcome "Welcome {user}!"` |
| `!setwelcome disable` | Disables the welcome message.                           | `!setwelcome disable`      |
| `!ban @user [reason]` | Bans a user from the server (Moderator).              | `!ban @User Spamming`      |
| `!kick @user [reason]` | Kicks a user from the server (Moderator).             | `!kick @User Rule break`   |
| `!timeout @user <duration> [reason]` | Times out a user (Moderator).            | `!timeout @User 5m Misbehaving` |
| `!warn @user [reason]` | Issues a warning to a user (Moderator).             | `!warn @User Off-topic`    |
| `!nuke`           | **(EXTREME CAUTION\!)** Deletes all channels and roles. Requires confirmation. (Server Owner Only) | `!nuke` |
| `!setantispam [setting <value>] ...` | Configures anti-spam settings (Admin).   | `!setantispam message_limit 7 time_window_seconds 10` |
| `!viewantispam`   | Views current anti-spam settings (Admin).                 | `!viewantispam`            |
| `!gotverified`    | Displays a list of verified users with their real names and college email addresses (Admin/Moderator). | `!gotverified` |

## Deployment on Render.com

This section provides detailed instructions for deploying  bot on Render.com.

**Important Note on Database Persistence:**
Bot uses SQLite (`bot.db`) for data storage. Render's standard web services use ephemeral storage, meaning any data written to the disk (like  `bot.db` file) will be lost on redeploys or restarts. To ensure  bot's data (user stats, anti-spam configs, suggestions, etc.) persists, you **must** configure a persistent disk.

### Steps to Deploy:

1.  **Push  Code to a Git Repository:**

      - Ensure all  bot files (including the `src` folder, `deploy-commands.js`, `package.json`, `.env.example` if you create one, and `service_account_key.json` if using it) are committed and pushed to a GitHub, GitLab, or Bitbucket repository.
      - **Crucially, add `bot.db` and `service_account_key.json` to  `.gitignore` file if  repository is public\!** You will upload `service_account_key.json` as a secret file on Render, and `bot.db` will be created by the persistent disk.

2.  **Create a Render Account:**

      - If you don't have one, sign up at [Render.com](https://render.com/). You can sign in with  GitHub account.

3.  **Create a New Web Service:**

      - From  Render Dashboard, click **"New"** -\> **"Web Service"**.
      - **Connect  Git repository:** Select the repository where  bot's code is hosted. You might need to grant Render access to  repository.
      - Click **"Connect"**.

4.  **Configure  Web Service:**

      - **Name:** Give  service a meaningful name (e.g., `pulchowk-discord-bot`).
      - **Region:** Choose a region closest to  users or where you prefer.
      - **Branch:** Select the Git branch you want to deploy from (e.g., `main` or `master`).
      - **Root Directory:** If  `package.json` is not in the root of  repository (e.g., it's in a `bot/` folder), specify that folder here. Otherwise, leave it blank.
      - **Runtime:** `Node`
      - **Build Command:** `npm install`
      - **Start Command:** `npm start` (This uses the `start` script defined in  `package.json`)
      - **Instance Type:** Choose a suitable instance type. The "Free" tier might be sufficient for a small bot, but keep in mind free instances spin down after inactivity. A paid tier (e.g., "Starter") is recommended for 24/7 uptime.

5.  **Add Environment Variables:**

      - Scroll down to the **"Environment Variables"** section.
      - Add each key-value pair from  local `.env` file here.
      - **Important:** For `GOOGLE_SERVICE_ACCOUNT_KEY_PATH`, you will use a **secret file** instead of an environment variable.

6.  **Add Secret File for `service_account_key.json`:**

      - Still in the **"Environment Variables"** section, click **"Add Secret File"**.
      - **Filename:** `service_account_key.json` (This must exactly match the filename you set in `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` in  `.env` and the path in  `holidays.js` command).
      - **Content:** Copy and paste the entire content of  local `service_account_key.json` file into this text area.
      - Click **"Add Secret File"**.

7.  **Configure Persistent Disk (Crucial for SQLite):**

      - Scroll down to the **"Disks"** section.
      - Click **"Add Disk"**.
      - **Name:** `bot-data` (or any descriptive name).
      - **Mount Path:** `/opt/render/project/bot.db` (This is the path where Render expects  `bot.db` file to be stored persistently. It aligns with where  `database.js` creates the `bot.db` file relative to the project root on Render's file system).
      - **Size:** Choose a small size (e.g., 1 GB) as SQLite databases are typically small.
      - Click **"Add Disk"**.

8.  **Create Web Service:**

      - Click **"Create Web Service"** at the bottom.

9.  **Monitor Deployment:**

      - Render will now start building and deploying  bot. You can monitor the progress in the logs.
      - If the build fails, check the build logs for errors (e.g., missing dependencies, syntax errors).
      - If the deploy succeeds but the bot doesn't come online, check the runtime logs for errors (e.g., incorrect environment variables, bot token issues, API key problems).

### After Deployment:

  - **Verify Bot Status:** Check  Discord server to see if the bot is online.
  - **Test Commands:** Try using  slash commands (`/verify`) and prefix commands (`!help`, `!setbirthday`, etc.) to ensure everything is working as expected.
  - **Data Persistence:** After testing, try manually restarting  Render service. Then, check if  `!mystats` or `!listsuggestions` data is still present. If it is,  persistent disk is working correctly.

**Troubleshooting Tips for Render:**

  - **"Web service failed to start"**: Check  `Start Command` and ensure  `package.json` `start` script is correct (`node src/bot.js`).
  - **"Cannot find module"**: Ensure all dependencies are listed in `package.json` and `npm install` ran successfully during the build.
  - **Bot goes offline**: If on a free tier, it will spin down after inactivity. Upgrade to a paid instance type for 24/7 uptime.
  - **Errors related to Google APIs**: Double-check all  Google API environment variables and the `service_account_key.json` content. Ensure the API is enabled in Google Cloud Console.
  - **Permissions errors (Discord)**: Verify  bot's permissions in the Discord Developer Portal and its role hierarchy in  server.

## 🤝 Contributing

Contributions are welcome\! If you have suggestions for improvements or new features, feel free to open an issue or submit a pull request.

- Fork the repository. 
- Create  feature branch (git checkout -b feature/AmazingFeature).
- Commit  changes (git commit -m 'Add some AmazingFeature').
- Push to the branch (git push origin feature/AmazingFeature).
- Open a Pull Request.

## 📄 License

This project is licensed under the [No Redistribution License](LICENSE).
