# Troubleshooting Guide

### "Unknown Interaction" / Button Failed

**Cause**: The bot was restarted.
**Solution**: Discord buttons/modals expire or become invalid when the bot process restarts (unless persistent logic is implemented, which we have for some stateless actions).

- **Fix**: Ignore the error. If you were in the middle of a form, please restart the command (e.g., `/createevent`). We have implemented **Interaction Expiry Handling** to silently ignore old interactions instead of showing an error.

---

### "You don't have permission to create events"

- Ensure you are the **Club President** or have the **Moderator Role**.
- Check if the club status is "Active".

---

### "Event visibility field error"

- **Fix**: Update the command. Visibility is now a command option (`/createevent club:xyz visibility:Public`), NOT a field in the modal popup (due to Discord's 5-field limit).

---

### "Google API Error" / Emails not sending

- Check if `REFRESH_TOKEN` in `.env` is expired.
- Ensure the `SENDER_EMAIL` account has Gmail API enabled in Google Cloud Console.
- Check bot logs for specific error codes.

---

### "Database Locked"

- SQLite can lock if multiple write operations happen simultaneously.
- The bot handles this with retry logic, but excessive rapid writes might cause delays.
