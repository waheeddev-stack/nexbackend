import nodemailer from "nodemailer";

let transporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

export async function sendVerificationEmail(to, otp, opts = {}) {
  const html = `<p>Your verification code is <strong>${otp}</strong>. It expires in ${opts.ttlMinutes || 10} minutes.</p>`;
  if (!transporter) {
    // Fallback for dev: log to console
    console.info(`DEV EMAIL -> to=${to} otp=${otp}`);
    return { success: true, dev: true };
  }
  const info = await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'no-reply@example.com',
    to,
    subject: opts.subject || 'Your verification code',
    html,
  });
  return { success: true, info };
}
 