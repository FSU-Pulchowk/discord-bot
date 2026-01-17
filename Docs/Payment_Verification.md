# Payment Verification System

The bot includes a built-in system for handling paid event registrations and verifying payments manually via Discord DMs.

## How it Works

### 1. For Event Participants

**When joining a paid event:**

1.  You receive a DM with payment instructions (eSewa/Khalti IDs, Bank details).
2.  Make the payment using your preferred method.
3.  Click **"Upload Payment Proof"** button in the DM.
4.  Send a screenshot/receipt (JPG, PNG, PDF, max 8MB).
5.  Status changes to **Pending Verification** 🟡.
6.  Wait for admin verification (usually within 24 hours).

**Status Codes:**

- 🟡 **Pending**: Proof uploaded, awaiting review.
- ✅ **Verified**: Payment approved, you are registered for the event.
- ❌ **Rejected**: Proof rejected (fuzzy, incorrect amount), you can resubmit.

---

### 2. For Club Organizers (Verifiers)

**Verification Process:**

1.  When a user uploads proof, the **Club President** and **Moderators** receive a DM.
2.  The DM contains:
    - Event Name
    - Participant Name
    - The Proof Image
3.  **Action Buttons:**
    - `Approve Payment`: Marks user as paid and registers them.
    - `Reject Payment`: Denies the proof and notifies user to retry.

**Who can verify?**

- Club President
- Users with the Club Moderator role

---

## Troubleshooting Payments

**"Cannot upload payment proof"**

- Ensure DMs are enabled from server members.
- Check file size is under 8MB.
- Use supported formats: JPG, PNG, PDF.

**"Payment verification not working"**

- Ensure you're a club president or moderator.
- Check if the club has a moderator role configured in `/clubsettings`.
