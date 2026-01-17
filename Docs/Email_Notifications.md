# Email Notifications

The bot integrates with Gmail API to send official notifications for critical actions.

## Trigger Events

### 1. Club Approval

- **Trigger**: Server admin approves a `/registerclub` request.
- **Recipient**: The Club President's verified email.
- **Content**: Congratulations message, club details, and next steps guide.

### 2. Event Approval

- **Trigger**: Club/Server admin approves a `/createevent` request.
- **Recipient**: The Event Creator's verified email.
- **Content**: Confirmation of approval, link to event post, and management tips.

---

## Configuration

To enable email notifications, the following `.env` variables must be set:

```env
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
REFRESH_TOKEN="..."
SENDER_EMAIL="college-email@pcampus.edu.np"
```

The system uses **OAuth2** with Gmail API to send emails securely without storing plain-text passwords.
