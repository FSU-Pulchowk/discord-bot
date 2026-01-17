# Setup Guide - FSU Discord Bot

## Quick Start

This guide will help you set up the FSU Discord Bot with the new permission system and event management features.

## Prerequisites

- Node.js 16 or higher
- Discord Bot Token
- Google Cloud Project (for email verification)
- PostgreSQL or SQLite database

## Step 1: Clone and Install

```bash
git clone <repository-url>
cd fsu-bot
npm install
```

## Step 2: Configure Environment Variables

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Edit `.env` and fill in the required values:

### Core Discord Configuration

```env
BOT_TOKEN="your_bot_token_here"
CLIENT_ID="your_client_id_here"
GUILD_ID="your_guild_id_here"
VERIFIED_ROLE_ID="your_verified_role_id_here"
```

### Permission Roles

```env
# For Pulchowk Campus FSU
MODERATOR_ROLE_ID="1364094348685479996"
ADMIN_ROLE_ID="1364069370543996969"
CLUB_PRESIDENT_ROLE_ID="1364094351155658866"
```

### Event Channels

```env
# Channel for Pulchowkian-only events (verified members)
PULCHOWKIAN_EVENTS_CHANNEL_ID="1364094394596069467"

# Channel for public events (anyone can register)
PUBLIC_EVENTS_CHANNEL_ID="1447074326963552367"

# Channel for event approvals
EVENT_APPROVAL_CHANNEL_ID="your_approval_channel_id"
```

### Google API (for email verification)

```env
GOOGLE_CLIENT_ID="your_client_id"
GOOGLE_CLIENT_SECRET="your_client_secret"
REFRESH_TOKEN="your_refresh_token"
SENDER_EMAIL="your_college_email@pcampus.edu.np"
COLLEGE_EMAIL_DOMAIN="pcampus.edu.np"
```

## Step 3: Database Setup

The bot uses SQLite by default. On first run, it will automatically create `bot.db` and all required tables.

### Manual Migration (if upgrading from old version)

If you have an existing database, run these commands in SQLite:

```sql
-- Add columns for non-verified user registration
ALTER TABLE event_participants ADD COLUMN phone_number TEXT DEFAULT NULL;
ALTER TABLE event_participants ADD COLUMN temp_email TEXT DEFAULT NULL;
ALTER TABLE event_participants ADD COLUMN is_verified BOOLEAN DEFAULT 0;

-- Add column for Pulchowkian events channel
ALTER TABLE clubs ADD COLUMN private_event_channel_id TEXT DEFAULT NULL;
```

## Step 4: Deploy Commands

Deploy slash commands to Discord:

```bash
# For testing (instant)
node deploy-commands.js --guild

# For production (takes up to 1 hour)
node deploy-commands.js --global
```

## Step 5: Start the Bot

```bash
npm start
```

## Step 6: Verify Setup

1. **Test Verification System**

   - Run `/verify` command
   - Check if OTP email is received
   - Complete verification

2. **Test Event Creation**

   - Run `/createevent`
   - Select visibility option
   - Upload poster
   - Verify event posts to correct channel

3. **Test Non-Verified Registration**

   - Use account without verified role
   - Click "Join Event" button
   - Fill in email and phone
   - Verify data is stored

4. **Test Club Registration Permissions**
   - Try `/registerclub` with different roles
   - Verify permission checks work

## Permission System Setup

### Creating Required Roles

If your server doesn't have these roles, create them:

1. Go to Server Settings → Roles
2. Create new roles:

   - **Pulchowkian** (Verified Role)
   - **Moderator** (Club/Event Management)
   - **Administrator** (Full Access)
   - **Club President** (Club Leaders)

3. Right-click each role → Copy ID
4. Add IDs to `.env` file

### Assigning Initial Roles

- **Verified Role**: Assigned automatically via `/verify`
- **Moderator/Admin**: Manually assign to trusted users
- **Club President**: Assign to existing club presidents

## Channel Setup

### Creating Event Channels

1. **Pulchowkian Events Channel**

   - Create a text channel
   - Name: `#pulchowkian-events` or similar
   - Permissions: View by all, post by bot only
   - Copy ID to `PULCHOWKIAN_EVENTS_CHANNEL_ID`

2. **Public Events Channel**

   - Create a text channel
   - Name: `#public-events` or similar
   - Permissions: View by all, post by bot only
   - Copy ID to `PUBLIC_EVENTS_CHANNEL_ID`

3. **Event Approval Channel**
   - Create a private admin channel
   - Name: `#event-approvals` or similar
   - Permissions: Admin only
   - Copy ID to `EVENT_APPROVAL_CHANNEL_ID`

## Troubleshooting

### Bot Won't Start

- Check `BOT_TOKEN` is correct
- Verify all required environment variables are set
- Check console for error messages

### Commands Not Appearing

- Wait up to 1 hour for global commands
- Use `--guild` flag for instant testing
- Verify `CLIENT_ID` and `GUILD_ID` are correct

### Email Verification Not Working

- Check Google API credentials
- Verify `SENDER_EMAIL` is correct
- Check Gmail API is enabled in Google Cloud Console

### Permission Errors

- Verify role IDs are correct
- Check bot has required permissions
- Ensure bot role is higher than assigned roles

## Next Steps

- Read [Permission_System.md](./Permission_System.md) for detailed permission info
- See [Event_Management_Advanced.md](./Event_Management_Advanced.md) for event features
- Check [Troubleshooting.md](./Troubleshooting.md) for common issues

## Support

For issues or questions:

1. Check documentation in `Docs/` folder
2. Review error logs in console
3. Contact server administrators
