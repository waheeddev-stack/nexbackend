// Lightweight Twilio helper with console fallback
import Twilio from "twilio";

let twClient = null;
if (process.env.TWILIO_SID && process.env.TWILIO_TOKEN) {
  try {
    twClient = Twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
  } catch (err) {
    console.warn("Twilio init failed:", err?.message || err);
  }
}

export async function sendVerificationSms(phone, otp, opts = {}) {
  const body = opts.body || `Your verification code is ${otp}. It expires in ${opts.ttlMinutes || 10} minutes.`;
  if (!twClient || !process.env.TWILIO_FROM) {
    console.info(`DEV SMS -> to=${phone} otp=${otp}`);
    return { success: true, dev: true };
  }
  const msg = await twClient.messages.create({
    to: phone,
    from: process.env.TWILIO_FROM,
    body,
  });
  return { success: true, msg };
}
