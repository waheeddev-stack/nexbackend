import nodemailer from "nodemailer";

import {
  sendPasswordResetEmailResend,
  sendPasswordResetConfirmationResend,
} from "./email.resend.js";

/**
 * Check if Resend is configured
 */
const isResendConfigured = () => {
  return !!process.env.RESEND_API_KEY;
};

/**
 * Get the nodemailer createTransport function
 * Handles both CommonJS and ES module exports
 */
const getCreateTransport = () => {
  // Try different ways nodemailer might be exported
  if (typeof nodemailer?.createTransport === "function") {
    return nodemailer.createTransport.bind(nodemailer);
  }
  if (typeof nodemailer?.default?.createTransport === "function") {
    return nodemailer.default.createTransport.bind(nodemailer.default);
  }

  // Log what we actually got
  console.error("[EMAIL] nodemailer object:", {
    hasCreateTransport: !!nodemailer?.createTransport,
    hasDefault: !!nodemailer?.default,
    hasDefaultCreateTransport: !!nodemailer?.default?.createTransport,
    type: typeof nodemailer,
    keys: Object.keys(nodemailer || {}),
  });

  throw new Error(
    "nodemailer.createTransport is not available. Module may not be installed correctly."
  );
};

/**
 * Create email transporter for sending emails
 */
const createTransporter = () => {
  try {
    const createTransport = getCreateTransport();

    // Gmail configuration with timeouts and IPv4 enforcement
    // Try port 465 (SSL) as port 587 may be blocked on Render
    const transporter = createTransport({
      host: "smtp.gmail.com",
      port: 465, // Use port 465 (SSL) - more likely to work on restricted networks
      secure: true, // Use SSL
      auth: {
        user: process.env.EMAIL_USER || "resetnexkirana@gmail.com",
        pass: process.env.EMAIL_PASSWORD, // App-specific password
      },
      tls: {
        rejectUnauthorized: false,
        minVersion: "TLSv1.2",
      },
      // Add connection timeouts to prevent hanging
      connectionTimeout: 15000, // 15 seconds (increased for slower connections)
      greetingTimeout: 15000, // 15 seconds
      socketTimeout: 20000, // 20 seconds
      // Force IPv4 to avoid IPv6 connectivity issues on some servers
      family: 4,
    });

    return transporter;
  } catch (error) {
    console.error("[EMAIL] Error creating transporter:", error.message);
    throw new Error(`Failed to create email transporter: ${error.message}`, {
      cause: error,
    });
  }
};

/**
 * Send password reset email
 * Uses Resend if configured (for production), falls back to Gmail SMTP (for local)
 * @param {string} to - Recipient email
 * @param {string} resetToken - Password reset token
 * @param {string} userName - User's name
 * @returns {Promise<Object>} Email send result
 */
export const sendPasswordResetEmail = async (to, resetToken, userName) => {
  // Use Resend if configured (production on Render)
  if (isResendConfigured()) {
    console.log("[EMAIL] Using Resend for email delivery");
    return await sendPasswordResetEmailResend(to, resetToken, userName);
  }

  // Fall back to Gmail SMTP (local development)
  console.log("[EMAIL] Using Gmail SMTP for email delivery");
  return await sendPasswordResetEmailGmail(to, resetToken, userName);
};

/**
 * Send password reset email via Gmail SMTP
 * Used for local development
 */
const sendPasswordResetEmailGmail = async (to, resetToken, userName) => {
  try {
    console.log(`[EMAIL] Attempting to send password reset email to: ${to}`);
    const transporter = createTransporter();

    // Skip verify() as it can hang - we'll catch errors during send instead
    console.log("[EMAIL] Transporter created, proceeding to send email...");

    // Create reset link (adjust URL based on your app's deep linking setup)
    const resetLink = `nexkirana://reset-password?token=${resetToken}`;

    const mailOptions = {
      from: {
        name: "NexKirana",
        address: process.env.EMAIL_USER || "resetnexkirana@gmail.com",
      },
      to,
      subject: "Password Reset Request - NexKirana Account",
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta http-equiv="X-UA-Compatible" content="IE=edge">
          <title>Password Reset Request - NexKirana</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f6f6f6; line-height: 1.5;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f6f6f6; padding: 40px 20px;">
            <tr>
              <td align="center">
                <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border: 1px solid #ddd;">
                  
                  <!-- Header -->
                  <tr>
                    <td style="background-color: #232f3e; padding: 20px 40px; border-bottom: 4px solid #ff9900;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td align="left">
                            <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 400; letter-spacing: 0.5px;">NexKirana</h1>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  
                  <!-- Main Content -->
                  <tr>
                    <td style="padding: 40px 40px 30px 40px;">
                      <h2 style="color: #111111; margin: 0 0 20px 0; font-size: 22px; font-weight: 700; line-height: 1.3;">Password Reset Request</h2>
                      
                      <p style="color: #111111; font-size: 14px; line-height: 1.6; margin: 0 0 10px 0;">
                        Hello ${userName || "Customer"},
                      </p>
                      
                      <p style="color: #111111; font-size: 14px; line-height: 1.6; margin: 0 0 20px 0;">
                        We received a request to reset the password for your NexKirana account. Click the button below to reset your password:
                      </p>
                      
                      <!-- CTA Button -->
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 25px 0;">
                        <tr>
                          <td align="left" style="padding: 0;">
                            <a href="${resetLink}" 
                               style="display: inline-block; 
                                      background-color: #ff9900; 
                                      color: #111111; 
                                      text-decoration: none; 
                                      padding: 12px 30px; 
                                      border-radius: 3px; 
                                      font-size: 14px; 
                                      font-weight: 700; 
                                      border: 1px solid #e77600;">
                              Reset Password
                            </a>
                          </td>
                        </tr>
                      </table>
                      
                      <p style="color: #555555; font-size: 13px; line-height: 1.5; margin: 20px 0 8px 0;">
                        If the button above doesn't work, copy and paste this link into your browser:
                      </p>
                      <p style="color: #0066c0; 
                                font-size: 12px; 
                                word-break: break-all; 
                                margin: 0 0 25px 0; 
                                padding: 12px; 
                                background-color: #f3f3f3; 
                                border: 1px solid #ddd;
                                border-radius: 3px;">
                        ${resetLink}
                      </p>
                      
                      <!-- Security Notice -->
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 25px 0;">
                        <tr>
                          <td style="background-color: #f7f7f7; 
                                     border-left: 3px solid #555555; 
                                     padding: 15px 20px;">
                            <p style="color: #111111; font-size: 13px; margin: 0 0 8px 0; font-weight: 700;">
                              Security Information
                            </p>
                            <p style="color: #333333; font-size: 13px; margin: 0; line-height: 1.5;">
                              This link will expire in 1 hour for your protection. If you did not request this password reset, please ignore this email. Your account remains secure.
                            </p>
                          </td>
                        </tr>
                      </table>
                      
                      <!-- Additional Info -->
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 20px 0 0 0;">
                        <tr>
                          <td style="padding: 15px 0; border-top: 1px solid #e7e7e7;">
                            <p style="color: #111111; font-size: 13px; margin: 0 0 10px 0; line-height: 1.5;">
                              <strong>Why did I receive this email?</strong>
                            </p>
                            <p style="color: #555555; font-size: 13px; margin: 0 0 15px 0; line-height: 1.5;">
                              This email was sent because a password reset was requested for your account.
                            </p>
                            <p style="color: #111111; font-size: 13px; margin: 0 0 10px 0; line-height: 1.5;">
                              <strong>Didn't request this?</strong>
                            </p>
                            <p style="color: #555555; font-size: 13px; margin: 0; line-height: 1.5;">
                              If you did not make this request, please contact our support team immediately.
                            </p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  
                  <!-- Footer -->
                  <tr>
                    <td style="background-color: #f6f6f6; padding: 30px 40px; border-top: 1px solid #e7e7e7;">
                      <p style="color: #555555; font-size: 13px; margin: 0 0 10px 0; line-height: 1.5;">
                        Need help? Contact our support team:
                      </p>
                      <p style="color: #111111; font-size: 13px; margin: 0 0 20px 0;">
                        <a href="mailto:resetnexkirana@gmail.com" 
                           style="color: #0066c0; 
                                  text-decoration: none;">
                          resetnexkirana@gmail.com
                        </a>
                      </p>
                      
                      <div style="border-top: 1px solid #ddd; padding-top: 20px; margin-top: 20px;">
                        <p style="color: #777777; font-size: 11px; margin: 0 0 5px 0;">
                          © ${new Date().getFullYear()} NexKirana. All rights reserved.
                        </p>
                        <p style="color: #999999; font-size: 11px; margin: 0; line-height: 1.4;">
                          This is an automated message. Please do not reply to this email.<br>
                          This email was sent to: ${to}
                        </p>
                      </div>
                    </td>
                  </tr>
                </table>
                
                <!-- Email Client Spacer -->
                <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; margin-top: 20px;">
                  <tr>
                    <td style="text-align: center; padding: 0 20px;">
                      <p style="color: #a0aec0; font-size: 11px; margin: 0; line-height: 1.5;">
                        You're receiving this email because you have a NexKirana account.<br>
                        This email was sent to: ${to}
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
      text: `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                        NEXKIRANA - PASSWORD RESET REQUEST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Dear ${userName || "Valued Customer"},

We have received a request to reset the password for your NexKirana account.

To proceed with resetting your password, please click the link below or copy 
and paste it into your browser:

${resetLink}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔒 SECURITY INFORMATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• This secure link will expire in 1 HOUR for your protection
• If you did not request this password reset, please disregard this email
• Your account remains secure, and no changes have been made
• This link is encrypted using JWE (JSON Web Encryption) technology

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NEED ASSISTANCE?
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

If you believe this is suspicious activity or need help, please contact 
our support team immediately:

Email: resetnexkirana@gmail.com

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

© ${new Date().getFullYear()} NexKirana. All rights reserved.

This is an automated message. Please do not reply directly to this email.
You're receiving this email because you have a NexKirana account.
This email was sent to: ${to}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      `,
    };

    console.log("[EMAIL] Sending email...");

    // Wrap sendMail in a timeout promise to prevent hanging
    const sendEmailPromise = transporter.sendMail(mailOptions);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error("Email send timeout after 20 seconds")),
        20000
      );
    });

    const info = await Promise.race([sendEmailPromise, timeoutPromise]);

    console.log(
      `[EMAIL] ✅ Password reset email sent successfully! Message ID: ${info.messageId}`
    );

    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error) {
    console.error(
      "[EMAIL] ❌ Error sending password reset email:",
      error.message
    );
    console.error("[EMAIL] Error details:", {
      code: error.code,
      command: error.command,
      response: error.response,
      responseCode: error.responseCode,
    });

    // Provide more specific error messages
    if (error.code === "EAUTH") {
      throw new Error(
        "Email authentication failed. Please check EMAIL_USER and EMAIL_PASSWORD in .env",
        { cause: error }
      );
    } else if (error.code === "ECONNECTION" || error.code === "ETIMEDOUT") {
      throw new Error(
        "Unable to connect to email server. Please check your internet connection",
        { cause: error }
      );
    } else if (error.responseCode === 550) {
      throw new Error("Email address not found or rejected by server", {
        cause: error,
      });
    } else if (error.responseCode === 554) {
      throw new Error("Email rejected due to spam or policy violation", {
        cause: error,
      });
    }

    throw new Error(`Failed to send password reset email: ${error.message}`, {
      cause: error,
    });
  }
};

/**
 * Send password reset confirmation email
 * Uses Resend if configured, falls back to Gmail SMTP
 * @param {string} to - Recipient email
 * @param {string} userName - User's name
 * @returns {Promise<Object>} Email send result
 */
export const sendPasswordResetConfirmation = async (to, userName) => {
  // Use Resend if configured
  if (isResendConfigured()) {
    return await sendPasswordResetConfirmationResend(to, userName);
  }

  // Fall back to Gmail SMTP
  return await sendPasswordResetConfirmationGmail(to, userName);
};

/**
 * Send password reset confirmation email via Gmail SMTP
 */
const sendPasswordResetConfirmationGmail = async (to, userName) => {
  try {
    const transporter = createTransporter();

    const mailOptions = {
      from: {
        name: "NexKirana",
        address: process.env.EMAIL_USER || "resetnexkirana@gmail.com",
      },
      to,
      subject: "Security Alert: Password Successfully Changed - NexKirana",
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta http-equiv="X-UA-Compatible" content="IE=edge">
          <title>Password Successfully Changed - NexKirana</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f6f6f6; line-height: 1.5;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f6f6f6; padding: 40px 20px;">
            <tr>
              <td align="center">
                <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border: 1px solid #ddd;">
                  
                  <!-- Success Header -->
                  <tr>
                    <td style="background-color: #232f3e; padding: 20px 40px; border-bottom: 4px solid #ff9900;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td align="left">
                            <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 400; letter-spacing: 0.5px;">NexKirana</h1>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  
                  <!-- Main Content -->
                  <tr>
                    <td style="padding: 40px 40px 30px 40px;">
                      <h2 style="color: #111111; margin: 0 0 20px 0; font-size: 22px; font-weight: 700; line-height: 1.3;">Password Successfully Changed</h2>
                      
                      <p style="color: #111111; font-size: 14px; line-height: 1.6; margin: 0 0 10px 0;">
                        Hello ${userName || "Customer"},
                      </p>
                      
                      <p style="color: #111111; font-size: 14px; line-height: 1.6; margin: 0 0 20px 0;">
                        This email confirms that your NexKirana account password has been successfully changed. You can now sign in using your new password.
                      </p>
                      
                      <!-- Account Details -->
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 20px 0;">
                        <tr>
                          <td style="background-color: #f7f7f7; 
                                     padding: 15px 20px; 
                                     border: 1px solid #ddd;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                              <tr>
                                <td style="padding: 8px 0;">
                                  <p style="color: #555555; font-size: 12px; margin: 0; text-transform: uppercase; letter-spacing: 0.5px;">Account Email</p>
                                  <p style="color: #111111; font-size: 14px; margin: 5px 0 0 0; font-weight: 700;">${to}</p>
                                </td>
                              </tr>
                              <tr>
                                <td style="padding: 8px 0; border-top: 1px solid #ddd;">
                                  <p style="color: #555555; font-size: 12px; margin: 0; text-transform: uppercase; letter-spacing: 0.5px;">Changed On</p>
                                  <p style="color: #111111; font-size: 14px; margin: 5px 0 0 0; font-weight: 700;">${new Date().toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" })}</p>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                      
                      <!-- Security Alert -->
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 25px 0;">
                        <tr>
                          <td style="background-color: #fff3cd; 
                                     border-left: 3px solid #856404; 
                                     padding: 15px 20px;">
                            <p style="color: #111111; font-size: 13px; margin: 0 0 8px 0; font-weight: 700;">
                              Didn't Make This Change?
                            </p>
                            <p style="color: #333333; font-size: 13px; margin: 0 0 10px 0; line-height: 1.5;">
                              If you did not authorize this password change, your account may be compromised. Please take immediate action:
                            </p>
                            <ul style="color: #333333; font-size: 13px; margin: 0; padding-left: 20px; line-height: 1.6;">
                              <li>Contact our support team immediately</li>
                              <li>Reset your password again using a secure device</li>
                              <li>Review your recent account activity</li>
                            </ul>
                          </td>
                        </tr>
                      </table>
                      
                      <!-- Security Tips -->
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 20px 0 0 0;">
                        <tr>
                          <td style="padding: 15px 0; border-top: 1px solid #e7e7e7;">
                            <p style="color: #111111; font-size: 13px; margin: 0 0 10px 0; font-weight: 700;">
                              Security Best Practices
                            </p>
                            <ul style="color: #555555; font-size: 13px; margin: 0; padding-left: 20px; line-height: 1.6;">
                              <li>Never share your password with anyone</li>
                              <li>Use a unique password for your NexKirana account</li>
                              <li>Enable two-factor authentication if available</li>
                              <li>Regularly update your password every 90 days</li>
                            </ul>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  
                  <!-- Footer -->
                  <tr>
                    <td style="background-color: #f6f6f6; padding: 30px 40px; border-top: 1px solid #e7e7e7;">
                      <p style="color: #555555; font-size: 13px; margin: 0 0 10px 0; line-height: 1.5;">
                        Need help? Contact our support team:
                      </p>
                      <p style="color: #111111; font-size: 13px; margin: 0 0 20px 0;">
                        <a href="mailto:resetnexkirana@gmail.com" 
                           style="color: #0066c0; 
                                  text-decoration: none;">
                          resetnexkirana@gmail.com
                        </a>
                      </p>
                      
                      <div style="border-top: 1px solid #ddd; padding-top: 20px; margin-top: 20px;">
                        <p style="color: #777777; font-size: 11px; margin: 0 0 5px 0;">
                          © ${new Date().getFullYear()} NexKirana. All rights reserved.
                        </p>
                        <p style="color: #999999; font-size: 11px; margin: 0; line-height: 1.4;">
                          This is an automated security notification. Please do not reply to this email.<br>
                          This email was sent to: ${to}
                        </p>
                      </div>
                    </td>
                  </tr>
                </table>
                
                <!-- Email Client Spacer -->
                <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; margin-top: 20px;">
                  <tr>
                    <td style="text-align: center; padding: 0 20px;">
                      <p style="color: #a0aec0; font-size: 11px; margin: 0; line-height: 1.5;">
                        You're receiving this security notification because your password was changed.<br>
                        This email was sent to: ${to}
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
      text: `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
              NEXKIRANA - PASSWORD SUCCESSFULLY CHANGED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Dear ${userName || "Valued Customer"},

This email confirms that your NexKirana account password has been 
successfully changed. You can now sign in to your account using your 
new password.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ACCOUNT DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Account Email: ${to}
Changed On: ${new Date().toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" })}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ DIDN'T MAKE THIS CHANGE?
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

If you did not authorize this password change, your account may be 
compromised. Please take immediate action:

• Contact our support team immediately at resetnexkirana@gmail.com
• Reset your password again using a secure device
• Review your recent account activity

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🛡️ SECURITY BEST PRACTICES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Never share your password with anyone
• Use a unique password for your NexKirana account
• Enable two-factor authentication if available
• Regularly update your password every 90 days

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NEED ASSISTANCE?
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Our support team is here to help.
Email: resetnexkirana@gmail.com

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

© ${new Date().getFullYear()} NexKirana. All rights reserved.

This is an automated security notification. Please do not reply directly 
to this email. Secured with JWE encryption technology.

You're receiving this security notification because your password was changed.
This email was sent to: ${to}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Password reset confirmation email sent:", info.messageId);

    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error) {
    console.error("Error sending confirmation email:", error);
    throw new Error("Failed to send confirmation email", { cause: error });
  }
};

export default {
  sendPasswordResetEmail,
  sendPasswordResetConfirmation,
};
