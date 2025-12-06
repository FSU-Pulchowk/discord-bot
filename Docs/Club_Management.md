# Club Management

## Registering a Club

**Command:** `/registerclub`

**Requirements:**

- Must be a verified `@Pulchowkian` member
- Only one club per user as president

**Process:**

1. Run `/registerclub`
2. Fill out the registration modal:
   - Club name (e.g., "Robotics Club")
   - Club slug (unique identifier, e.g., "robotics")
   - Description
   - Category (Academic, Cultural, Sports, Technical, Social)
3. Submit and wait for admin approval (a DM will be sent upon approval)

**Status:** `Pending` → `Active` (after admin approval)

---

## Club Settings

**Command:** `/clubsettings`

Modify club settings including:

- **Event approval requirements**: Choose whether events need admin approval
- **Default event visibility**: Set default to Club-only, Guild-only, or Public
- **Auto-join settings**: Control if users can join automatically or need approval
- **Payment verification settings**: Manage how payments are verified

---

## Managing Club Members

### Join Requests

- Users can request to join clubs via `/joinclub`
- Presidents and moderators receive DM notifications
- Approve/reject requests via interactive buttons in DM or plugin channel

### Club Roles

- **President**: Full access, including transfer and deletion
- **Moderator**: Can manage events and members
- **Member**: Can attend private events

### Transfer Presidency

**Command:** `/transferpresident`

- Transfer club leadership to another member
- Requires confirmation from the new president via DM button
- Old president becomes a regular member

---

## Club Information

**Command:** `/clubinfo <club>`

View detailed information about any club:

- Club name, slug, status
- President and moderator list
- Member count
- Statistics (events held, total participants)
