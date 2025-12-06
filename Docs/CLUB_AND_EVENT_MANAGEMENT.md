# Club and Event Management System

## Overview

This Discord bot provides a comprehensive club and event management system for FSU Pulchowk, allowing verified members to register clubs, create events, manage participants, and handle payments.

---

## Table of Contents

- [Club Management](#club-management)
- [Event Management](#event-management)
- [Payment Verification](#payment-verification)
- [User Roles and Permissions](#user-roles-and-permissions)
- [Common Workflows](#common-workflows)

---

## Club Management

### Registering a Club

**Command:** `/registerclub`

**Requirements:**

- Must be a verified @Pulchowkian member
- Only one club per user as president

**Process:**

1. Run `/registerclub`
2. Fill out the registration modal:
   - Club name (e.g., "Robotics Club")
   - Club slug (unique identifier, e.g., "robotics")
   - Description
   - Category (Academic, Cultural, Sports, Technical, Social)
3. Submit and wait for admin approval

**Status:** Pending → Active (after admin approval)

### Club Settings

**Command:** `/clubsettings`

Modify club settings including:

- Event approval requirements
- Default event visibility (club/guild/public)
- Auto-join settings
- Payment verification settings

### Managing Club Members

**Join Requests:**

- Users can request to join clubs via `/joinclub`
- Presidents and moderators receive DM notifications
- Approve/reject requests via buttons

**Transfer Presidency:**

- **Command:** `/transferpresident`
- Transfer club leadership to another member
- Requires confirmation from new president

### Club Information

**Command:** `/clubinfo <club>`

View detailed information about any club:

- Club name, slug, status
- President and moderator role
- Member count
- Statistics (events, participants)

---

## Event Management

### Creating an Event

**Command:** `/createevent <club> [visibility]`

**Parameters:**

- `club`: Your club name or slug (autocomplete enabled)
- `visibility`: Public (all server) or Private (club members only) - _optional, defaults to public_

**Process:**

**Step 1: Basic Information Modal**

- Event Title
- Description
- Date & Time (format: YYYY-MM-DD HH:MM)
- Venue (Physical/Virtual/Hybrid)
- Event Type (workshop, seminar, competition, social, meeting, etc.)

**Step 2: Additional Details Modal**

- Max Participants (optional)
- Min Participants (optional)
- Registration Details (deadline, fee, form URL)
- Eligibility Criteria (batch, faculty restrictions)
- Meeting/Registration Link

**Step 3: Poster Upload**

- Upload event poster (JPG, PNG, max 8MB)
- Or skip to continue without poster

**Approval:**

- Events may require approval based on club settings
- Approved events are posted to appropriate channels

### Event Visibility Levels

| Level       | Visibility         | Posted To            |
| ----------- | ------------------ | -------------------- |
| **Public**  | All server members | Public event channel |
| **Private** | Club members only  | Private club channel |

### Event Registration

**User Side:**

1. Click "Register for Event" button on event post
2. If payment required, receive DM with payment instructions
3. Upload payment proof
4. Wait for admin verification

**Organizer Side:**

1. Receive payment verification requests via DM
2. Review payment proof
3. Approve or reject payment
4. User automatically added to participant list upon approval

### Event Participant Management

**Command:** `/eventparticipants <event_id>`

View all registered participants for an event:

- Name, email, RSVP status
- Payment status (if applicable)
- Export to Excel for records

---

## Payment Verification

### For Event Participants

**When joining a paid event:**

1. Receive DM with payment instructions
2. Make payment via eSewa/Khalti/Bank Transfer
3. Click "Upload Payment Proof" button
4. Send screenshot/receipt (JPG, PNG, PDF, max 8MB)
5. Wait for verification (usually within 24 hours)

**Payment Status:**

- 🟡 **Pending**: Proof uploaded, awaiting review
- ✅ **Verified**: Payment approved, registered for event
- ❌ **Rejected**: Proof rejected, can resubmit

### For Club Organizers

**Verification Process:**

1. Receive DM when member uploads payment proof
2. Review proof image/document
3. Click "Approve Payment" or "Reject Payment"
4. User receives notification of decision

**Who can verify:**

- Club president
- Users with club moderator role

---

## User Roles and Permissions

### Verified Member (@Pulchowkian)

- Register clubs
- Join clubs
- Register for events
- View club information

### Club President

- Full control over their club
- Create events
- Manage club settings
- Approve/reject join requests
- Verify event payments
- Transfer presidency

### Club Moderators

- Create events
- Approve/reject join requests
- Verify event payments

### Server Admins

- Approve/reject club registrations
- Approve/reject events (if required)
- Override any club settings

---

## Common Workflows

### Starting a New Club

```
1. /registerclub → Fill registration form
2. Wait for admin approval
3. /clubsettings → Configure club preferences
4. Invite members to join
5. /createevent → Start creating events
```

### Organizing a Paid Event

```
1. /createevent → Set registration fee in Step 2
2. Wait for event approval (if required)
3. Wait for participants to register
4. Receive payment verification requests via DM
5. Review and approve/reject payments
6. /eventparticipants → Export final list
```

### Joining a Club and Event

```
1. /joinclub <club> → Request to join
2. Wait for approval from club moderators
3. Browse events in event channels
4. Click "Register for Event" button
5. (If paid) Upload payment proof
6. Wait for confirmation
```

### Transferring Club Leadership

```
1. /transferpresident <club> <new_president>
2. New president receives DM with approval buttons
3. New president clicks "Accept Transfer"
4. Presidency transferred, old president becomes regular member
```

---

## Event Eligibility System

Events can specify eligibility criteria based on:

**Batch Restrictions:**

```
Batch: 078, 079, 080
```

**Faculty Restrictions:**

```
Faculty: Electronics, Computer, Mechanical
```

**Role-Based:**

```
Role: @Club Member, @Verified
```

Members who don't meet criteria cannot register for the event.

---

## Best Practices

### For Club Presidents

✅ **DO:**

- Set clear club descriptions
- Configure event approval settings appropriately
- Respond to join requests promptly
- Verify payments within 24 hours
- Keep event information up-to-date

❌ **DON'T:**

- Create duplicate clubs
- Approve suspicious payment proofs
- Change settings without informing members

### For Event Organizers

✅ **DO:**

- Upload high-quality event posters
- Specify clear registration deadlines
- Set realistic participant limits
- Test virtual meeting links before events
- Export participant lists before event day

❌ **DON'T:**

- Create events with past dates
- Set unrealistic fees
- Ignore payment verification requests

### For Participants

✅ **DO:**

- Upload clear payment proofs with visible transaction IDs
- Register before deadline
- Check eligibility criteria before registering
- Respect club rules and guidelines

❌ **DON'T:**

- Submit fake payment proofs
- Register for events you can't attend
- Spam join requests

---

## Troubleshooting

### "You don't have permission to create events"

- Ensure you're the club president or have the moderator role
- Check club status is "active"

### "Event visibility field error"

- Update bot to latest version
- Visibility is now a command option, not modal field

### "Cannot upload payment proof"

- Ensure DMs are enabled from server members
- Check file size is under 8MB
- Use supported formats: JPG, PNG, PDF

### "Payment verification not working"

- Ensure you're a club president or moderator
- Check if club has moderator role configured
- Contact bot admin if issue persists

---

## Database Schema Reference

### Key Tables

**clubs** - Club information and settings
**club_events** - Event details and metadata
**event_registrations** - Registration and payment tracking
**event_participants** - Final participant list
**club_members** - Club membership records
**verified_users** - Verified Pulchowkians

### Event Status Flow

```
pending → scheduled → ongoing → completed → cancelled
```

### Payment Status Flow

```
pending → verified / rejected
```

---

## Support

For issues or questions:

1. Check this documentation
2. Contact server admins
3. Report bugs to bot developers

---

**Last Updated:** December 6, 2025
**Bot Version:** 1.0
**Features:** Club Management, Event Management, Payment Verification, Excel Export
