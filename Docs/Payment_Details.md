# Payment Details Collection System

## Overview

The Payment Details Collection System ensures that event organizers provide secure payment methods when setting registration fees. This prevents phishing scams and provides participants with verified, safe payment options.

---

## For Event Organizers

### When Payment Details Are Required

Payment details are **automatically required** when you set a registration fee greater than Rs. 0 during event creation.

### Setting Up Payment Details

During the event creation process (after Step 2), you'll be prompted to provide payment collection details:

#### Step 3: Payment Details Modal

You must provide **at least ONE** of the following payment methods:

1. **Bank Account Details** (Text field)

   - Account Holder Name
   - Bank Name
   - Account Number
   - Example: `Account Holder: John Doe\nBank: Nepal Bank\nAccount: 1234567890`

2. **Khalti Number** (10 digits)

   - Your registered Khalti mobile number
   - Must be exactly 10 digits
   - Example: `9812345678`

3. **eSewa Number** (10 digits)

   - Your registered eSewa mobile number
   - Must be exactly 10 digits
   - Example: `9812345678`

4. **Payment Instructions** (Optional)
   - Additional notes for participants
   - Example: `Send payment proof to event organizers after payment`

#### Step 4: Payment QR Code Upload (Optional but Recommended)

After providing payment details, you can optionally upload a QR code image:

- **How to upload**: Sent via DM, similar to poster upload
- **Formats**: JPG, PNG, GIF
- **Size limit**: Max 8MB
- **Timeout**: 5 minutes to upload
- **Benefits**: Makes it easier for participants to pay via mobile apps

---

## Validation Rules

### Required Fields

- ✅ **At least ONE payment method is required** when registration fee > 0
- ❌ Cannot skip payment details even if you provide an external payment form URL
- ❌ Cannot create paid event without payment information

### Phone Number Validation

Khalti and eSewa numbers are validated to ensure correctness:

- ✅ Must be exactly **10 digits**
- ✅ Only numeric characters allowed
- ❌ No spaces, dashes, or special characters
- ❌ No country codes (+977)

**Valid Examples:**

- `9812345678` ✅
- `9841234567` ✅

**Invalid Examples:**

- `981234567` ❌ (9 digits)
- `98123456789` ❌ (11 digits)
- `+977-9812345678` ❌ (has country code and dash)
- `9812 345 678` ❌ (has spaces)

---

## Security Features

### Why Payment Details Are Required

1. **Prevents Phishing**: External payment URLs can be fake sites designed to steal payment information
2. **Verified Methods**: Bank details, Khalti, and eSewa are verified payment platforms in Nepal
3. **Participant Safety**: Ensures participants know exactly where to send money
4. **Transparency**: All payment information is stored and visible to participants

### What You Cannot Do

- ❌ Skip payment details by providing only an external form
- ❌ Use payment methods other than the approved ones
- ❌ Provide invalid or incomplete phone numbers
- ❌ Create paid event without any payment information

---

## For Participants

### Viewing Payment Details

When you register for a paid event:

1. Click **"Register for Event"** button
2. Payment details will be displayed:
   - Available payment methods (Bank/Khalti/eSewa)
   - Payment QR code (if provided)
   - Payment instructions from organizer
3. Make payment using your preferred method
4. Upload payment proof screenshot
5. Wait for verification

### Payment Options

You'll see payment methods provided by the organizer:

- **Bank Transfer**: Full account details for direct transfer
- **Khalti**: Scan QR or send to mobile number
- **eSewa**: Scan QR or send to mobile number

> **Tip:** QR codes make payment faster - just scan and pay!

---

## Database Storage

Payment details are stored in the `club_events` table:

| Column                 | Type | Description                   |
| ---------------------- | ---- | ----------------------------- |
| `bank_details`         | TEXT | Bank account information      |
| `payment_qr_url`       | TEXT | URL to payment QR code image  |
| `khalti_number`        | TEXT | 10-digit Khalti mobile number |
| `esewa_number`         | TEXT | 10-digit eSewa mobile number  |
| `payment_instructions` | TEXT | Additional payment notes      |
| `registration_fee`     | NUM  | Fee amount in Nepali Rupees   |

---

## Troubleshooting

### Common Issues

#### "At least one payment method is required"

**Problem:** Trying to create paid event without payment details

**Solution:** Fill in at least one of:

- Bank Account Details, OR
- Khalti Number, OR
- eSewa Number

#### "Invalid Khalti/eSewa number format"

**Problem:** Phone number is not exactly 10 digits

**Solution:**

- Remove any spaces, dashes, or country codes
- Ensure exactly 10 digits
- Example: `9812345678`

#### "Cannot skip payment details"

**Problem:** Trying to skip payment step even with external form

**Solution:** This is by design for security. You must provide at least one verified payment method.

---

## Best Practices

### For Organizers

1. **Provide Multiple Methods**: Offer both bank transfer and mobile wallets (Khalti/eSewa)
2. **Upload QR Code**: Makes payment much easier for participants
3. **Clear Instructions**: Use payment instructions field to clarify any specific requirements
4. **Verify Quickly**: Check payment proofs promptly to confirm registrations

### For Participants

1. **Save Payment Proof**: Screenshot or download receipt after payment
2. **Upload Clearly**: Ensure payment proof image is clear and readable
3. **Include Reference**: If possible, include event name in payment notes
4. **Wait Patiently**: Verification may take some time depending on organizers

---

## Example: Complete Payment Setup

Here's an example of a well-configured paid event:

**Registration Fee:** Rs. 100

**Bank Details:**

```
Account Holder: FSU Events Team
Bank: Nepal Bank Limited
Account: 0123456789012345
```

**Khalti Number:** `9812345678`

**eSewa Number:** `9841234567`

**Payment QR Code:** ✅ Uploaded (combined QR for both Khalti & eSewa)

**Payment Instructions:**

```
After payment, please upload a clear screenshot showing:
- Transaction ID
- Amount paid (Rs. 100)
- Date and time

Payment will be verified within 24 hours.
```

This setup gives participants maximum flexibility while maintaining security! 🎯
