# Permission System Documentation

## Overview

The FSU Discord Bot implements a comprehensive role-based permission system for event and club management. This document explains all permission requirements and access levels.

## Role Definitions

### Core Roles

1. **Verified Role (Pulchowkian)**

   - Environment variable: `VERIFIED_ROLE_ID`
   - Obtained through: `/verify` command with college email
   - Access: Base requirement for most club/event features

2. **Server Moderator**

   - Environment variable: `MODERATOR_ROLE_ID`
   - Role ID: `1364094348685479996`
   - Access: Club registration, event management, moderation

3. **Server Administrator**

   - Environment variable: `ADMIN_ROLE_ID`
   - Role ID: `1364069370543996969`
   - Access: Full system access, club/event approval

4. **Club President**
   - Environment variable: `CLUB_PRESIDENT_ROLE_ID`
   - Role ID: `1364094351155658866`
   - Access: Club registration, club-specific events

## Permission Matrix

| Action                             | Required Permissions                              |
| ---------------------------------- | ------------------------------------------------- |
| View events                        | Anyone                                            |
| Register for events (verified)     | Verified Role                                     |
| Register for events (non-verified) | None (email + phone required)                     |
| Create club events                 | Verified + (Club Moderator OR Club Member)        |
| Register new club                  | Verified + (Moderator OR Admin OR Club President) |
| Approve clubs                      | Server Administrator                              |
| Approve events                     | Server Moderator or Administrator                 |
| Export event data                  | Club Moderator                                    |

## Event Registration System

### Verified Users

- Have `VERIFIED_ROLE_ID` role
- Can directly register for events
- No additional information required
- Full access to all event features

### Non-Verified Users

- Do NOT have verified role
- Still can register for events
- **Must provide:**
  - Email address (validated format)
  - Phone number (10-15 digits, international format supported)
- Data stored in `event_participants` table:
  - `temp_email`: Email provided
  - `phone_number`: Phone number (normalized to +XXX-XXXXXXXXXX)
  - `is_verified`: 0 (false)

### Registration Flow

#### For Verified Users:

```
Click Join Event → Check eligibility → Register → Success
```

#### For Non-Verified Users:

```
Click Join Event → Modal (email + phone) → Validation → Store data → Success
```

## Event Visibility Levels

Events can have three visibility levels:

### 1. Pulchowkian Only (`pulchowkian`)

- **Channel**: `PULCHOWKIAN_EVENTS_CHANNEL_ID` (1364094394596069467)
- **Who can register**: Only verified Pulchowkians
- **Access**: Visible to all, but registration restricted

### 2. Public (Server-wide) (`public`)

- **Channel**: `PUBLIC_EVENTS_CHANNEL_ID` (1447074326963552367)
- **Who can register**: Anyone (verified or non-verified)
- **Access**: Open to entire server

### 3. Private (Club Only) (`private`)

- **Channel**: Club's private event channel (auto-created)
- **Who can register**: Club members only
- **Access**: Only club members can see/register

## Club Registration Restrictions

### Requirements

To register a new club, user **MUST** have:

1. **Verified Role** (`VERIFIED_ROLE_ID`) **AND**
2. One of the following:
   - Server Moderator role (`MODERATOR_ROLE_ID`)
   - Server Administrator role (`ADMIN_ROLE_ID`)
   - Club President role (`CLUB_PRESIDENT_ROLE_ID`)

### Validation Flow

```javascript
if (!hasVerifiedRole) {
  return "Must verify with /verify first";
}

if (!hasModerator && !hasAdmin && !hasPresident) {
  return "Unauthorized - requires Moderator, Admin, or Club President role";
}

// Proceed with registration
```

## Database Schema

### event_participants Table (Extended)

```sql
CREATE TABLE event_participants (
    id INTEGER PRIMARY KEY,
    event_id INTEGER,
    user_id TEXT,
    guild_id TEXT,
    -- New columns for non-verified users:
    phone_number TEXT DEFAULT NULL,
    temp_email TEXT DEFAULT NULL,
    is_verified BOOLEAN DEFAULT 0,
    -- ... other columns
);
```

### Non-Verified User Data

- **phone_number**: Normalized format (+977-98XXXXXXXX)
- **temp_email**: Email provided during registration
- **is_verified**: 0 (false) for non-verified, 1 (true) for verified

## Environment Configuration

Add these to your `.env` file:

```bash
# Core verification
VERIFIED_ROLE_ID="YOUR_VERIFIED_ROLE_ID"

# Permission roles
MODERATOR_ROLE_ID="1364094348685479996"
ADMIN_ROLE_ID="1364069370543996969"
CLUB_PRESIDENT_ROLE_ID="1364094351155658866"

# Event channels
PULCHOWKIAN_EVENTS_CHANNEL_ID="1364094394596069467"
PUBLIC_EVENTS_CHANNEL_ID="1447074326963552367"
EVENT_APPROVAL_CHANNEL_ID="YOUR_APPROVAL_CHANNEL_ID"
```

## Common Scenarios

### Scenario 1: Non-verified user wants to join event

1. User clicks "Join Event" button
2. System checks verified role → Not found
3. Modal appears requesting email and phone
4. User submits data
5. System validates format
6. Registration successful with contact data stored

### Scenario 2: Club wants to create private event

1. Club moderator uses `/createevent`
2. Selects visibility: "Private (Club Only)"
3. Event created and posted to club's private channel
4. Only club members can see and register

### Scenario 3: Someone wants to register a club

1. User attempts `/registerclub`
2. System checks: Verified? → Yes
3. System checks: Moderator/Admin/President? → No
4. **Error**: "Unauthorized: Club Registration Restricted"
5. User must contact admin to get appropriate role

## Security Considerations

1. **Email Validation**: Regex pattern validates email format
2. **Phone Normalization**: Phone numbers normalized to international format
3. **Role Stacking**: Users need BOTH verified AND permission role
4. **Data Privacy**: Non-verified contact data stored securely in database
5. **No Auto-Verify**: Non-verified users stay non-verified after registration

## Migration Notes

### Existing Database

Run these ALTER commands to add new columns:

```sql
ALTER TABLE event_participants ADD COLUMN phone_number TEXT DEFAULT NULL;
ALTER TABLE event_participants ADD COLUMN temp_email TEXT DEFAULT NULL;
ALTER TABLE event_participants ADD COLUMN is_verified BOOLEAN DEFAULT 0;
```

### Existing Users

- Verified users: No changes needed
- Non-verified users: Will be prompted for email/phone on next registration

## Troubleshooting

### "You are not eligible for this event"

- Check if you have required roles (verified, faculty, batch, etc.)
- Contact event organizer or server admin

### "Unauthorized: Club Registration Restricted"

- Ensure you have verified role (`/verify`)
- Request Moderator, Admin, or Club President role from server admin

### Modal doesn't appear for non-verified users

- Check browser/client for modal blocking
- Try restarting Discord client
- Check `interactionCreate.js` has modal handler
