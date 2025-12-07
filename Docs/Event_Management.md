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
    - Registration Details (deadline, fee, form URL)
    - Eligibility Criteria (batch, faculty restrictions)
    - Meeting/Registration Link

3.  **Payment Details Modal** _(Only shown if registration fee is set)_

    > **Security Note:** When you set a registration fee, you MUST provide at least one payment method. This prevents phishing scams and ensures participants have safe payment options.

    Required information (provide at least ONE):

    - **Bank Account Details**: Account holder name, bank name, account number
    - **Khalti Number**: 10-digit mobile number (e.g., 9812345678)
    - **eSewa Number**: 10-digit mobile number (e.g., 9812345678)
    - **Payment Instructions**: Additional notes for participants (optional)

    **Validation Rules:**

    - ✅ At least ONE payment method required when fee > 0
    - ✅ Khalti/eSewa numbers must be exactly 10 digits
    - ✅ Cannot skip payment details even with external form URL

4.  **Payment QR Code Upload** _(Optional but recommended)_

    - Upload QR code image for easy payments
    - Sent via DM, same as poster upload
    - Timeout: 5 minutes
    - Supported formats: JPG, PNG, GIF (max 8MB)
    - Can skip and proceed to poster upload

5.  **Poster Upload**
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
3.  If **Paid**, you receive payment details:
    - **Payment Methods Available**: Bank Transfer, Khalti, eSewa (as provided by organizer)
    - **Payment QR Code**: If uploaded, displayed for easy scanning
    - **Payment Instructions**: Additional notes from organizer
    - Upload payment proof image after making payment
    - Wait for verification by event organizers
4.  Receive confirmation DM upon successful verification.

### Payment Methods

Event organizers can provide multiple payment options:

- **Bank Transfer**: Full account details (holder, bank, account number)
- **Khalti**: 10-digit mobile number
- **eSewa**: 10-digit mobile number
- **QR Code**: Scannable image for quick payments

> **Note:** All payment details are verified and validated during event creation to ensure participant safety.

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
