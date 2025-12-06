# Event Management

## Creating an Event

**Command:** `/createevent <club> [visibility]`

**Parameters:**

- `club`: Your club name or slug (autocomplete enabled)
- `visibility`: `Public` (all server) or `Private` (club members only) - _optional, defaults to public_

### Step-by-Step Process:

1.  **Basic Information Modal**

    - Event Title
    - Description
    - Date & Time (format: YYYY-MM-DD HH:MM)
    - Venue (Physical/Virtual/Hybrid)
    - Event Type (workshop, seminar, competition, social, meeting, etc.)

2.  **Additional Details Modal**

    - Max Participants (optional limit)
    - Min Participants (optional)
    - Registration Details (deadline, fee check, form URL)
    - Eligibility Criteria (batch, faculty restrictions)
    - Meeting/Registration Link

3.  **Poster Upload**
    - Upload event poster (JPG, PNG, max 8MB)
    - Or skip to continue without poster

### Approval Workflow

- Events may require approval based on **Club Settings**.
- If approval is needed, admins get a request.
- Once approved, the event creator receives an **email notification** and the event is posted to the appropriate channel.

---

## Event Visibility Levels

| Level       | Visibility         | Posted To            |
| ----------- | ------------------ | -------------------- |
| **Public**  | All server members | Public event channel |
| **Private** | Club members only  | Private club channel |

---

## Event Registration

### User Experience

1.  Click **"Register for Event"** button on the event post.
2.  If the event is **Free**, you are registered immediately.
3.  If **Paid**, you receive a DM with payment instructions.
    - Upload payment proof image.
    - Wait for verification.
4.  receive confirmation DM upon success.

### Organizer Experience

- **Participant List**: Use `/eventparticipants <event_id>` to view list.
- **Export**: You can export the participant list to Excel for attendance tracking.

---

## Eligibility System

Events can specify eligibility criteria:

- **Batch Restrictions**: e.g., `078, 079, 080`
- **Faculty Restrictions**: e.g., `Electronics, Computer, Civil`
- **Role-Based**: e.g., `@Club Member` only

Members who don't meet these criteria cannot register.
