/**
 * Generates a random 6-digit OTP.
 * @returns {string} The 6-digit OTP as a string.
 */
export function generateOtp() {
    const otp = Math.floor(100000 + Math.random() * 900000);
    return otp.toString();
}
