import { Resend } from "resend";

/**
 * Resend Email Service
 * Free tier: 100 emails/day
 * Works on Render (uses HTTPS API, not SMTP)
 */

// Initialize Resend
const getResend = () => {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.warn("[RESEND] API key not configured. Email sending will fail.");
    return null;
  }

  console.log("[RESEND] Initialized successfully");
  return new Resend(apiKey);
};

/**
 * Get the sender (Resend requires a verified domain)
 */
const getFrom = () => {
  const fromName = process.env.RESEND_FROM_NAME || "NexKirana";
  const fromEmail =
    process.env.RESEND_FROM_EMAIL ||
    process.env.EMAIL_USER ||
    "resetnexkirana@gmail.com";
  return `${fromName} <${fromEmail}>`;
};

/**
 * Send password reset email via Resend
 */
export const sendPasswordResetEmailResend = async (
  to,
  resetToken,
  userName
) => {
  try {
    console.log(`[RESEND] Sending password reset email to: ${to}`);

    const resend = getResend();
    if (!resend) {
      throw new Error(
        "Resend not configured. Please set RESEND_API_KEY in environment variables."
      );
    }

    // Direct app deep link — opens zeu app at reset-password screen (package com.zeu.customer)
    const appDeepLink = `zeu://reset-password?token=${encodeURIComponent(resetToken)}`;
    const legacyDeepLink = `nexkirana://reset-password?token=${encodeURIComponent(resetToken)}`;
    // Website fallback — used when the app button doesn't work (copy/paste link)
    const webLink = `https://app.zeu.in/reset-password?token=${encodeURIComponent(resetToken)}`;
    // HTTPS backend fallback (legacy intermediate page that then redirects to app)
    const backendUrl =
      process.env.RESET_REDIRECT_URL ||
      process.env.RENDER_EXTERNAL_URL ||
      "https://nexbackend.onrender.com";
    const backendRedirectLink = `${backendUrl}/api/password-reset/redirect?token=${encodeURIComponent(resetToken)}`;
    // RESET_LINK points to app deep link (button), fallback shows website link
    const resetLink = appDeepLink;

    const templateId = process.env.RESEND_TEMPLATE_PASSWORD_RESET;

    const message = {
      from: getFrom(),
      to: [to],
      subject: "Password Reset Request - NexKirana Account",
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
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Password Reset Request - NexKirana</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f6f6f6;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f6f6f6; padding: 40px 20px;">
            <tr>
              <td align="center">
                <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border: 1px solid #ddd;">
                  
                  <!-- Header -->
                  <tr>
                    <td style="background-color: #232f3e; padding: 20px 40px; border-bottom: 4px solid #ff9900;">
                      <h1 style="color: #ffffff; margin: 0; font-size: 24px;">NexKirana</h1>
                    </td>
                  </tr>
                  
                  <!-- Content -->
                  <tr>
                    <td style="padding: 40px;">
                      <h2 style="color: #111111; margin: 0 0 20px 0; font-size: 22px;">Password Reset Request</h2>
                      
                      <p style="color: #111111; font-size: 14px; line-height: 1.6; margin: 0 0 10px 0;">
                        Hello ${userName || "Customer"},
                      </p>
                      
                      <p style="color: #111111; font-size: 14px; line-height: 1.6; margin: 0 0 20px 0;">
                        We received a request to reset the password for your NexKirana account. Click the button below to reset your password:
                      </p>
                      
                      <!-- Button -->
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 25px 0;">
                        <tr>
                          <td align="left">
                            <a href="${resetLink}" 
                               style="display: inline-block; 
                                      background-color: #ff9900; 
                                      color: #111111; 
                                      text-decoration: none; 
                                      padding: 12px 30px; 
                                      border-radius: 3px; 
                                      font-size: 14px; 
                                      font-weight: 700;">
                              Reset Password
                            </a>
                          </td>
                        </tr>
                      </table>
                      
                      <p style="color: #555555; font-size: 13px; margin: 20px 0 8px 0;">
                        If the button doesn't work, copy and paste this link:
                      </p>
                      <p style="color: #0066c0; 
                                font-size: 12px; 
                                word-break: break-all; 
                                margin: 0 0 25px 0; 
                                padding: 12px; 
                                background-color: #f3f3f3; 
                                border: 1px solid #ddd;">
                        ${webLink}
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
                            <p style="color: #333333; font-size: 13px; margin: 0;">
                              This link expires in 1 hour. If you didn't request this, ignore this email.
                            </p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  
                  <!-- Footer -->
                  <tr>
                    <td style="background-color: #f6f6f6; padding: 30px 40px; border-top: 1px solid #e7e7e7;">
                      <p style="color: #555555; font-size: 13px; margin: 0 0 10px 0;">
                        Need help? Contact: <a href="mailto:resetnexkirana@gmail.com" style="color: #0066c0;">resetnexkirana@gmail.com</a>
                      </p>
                      <p style="color: #777777; font-size: 11px; margin: 0;">
                        © ${new Date().getFullYear()} NexKirana. All rights reserved.
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
    };

    let sendPayload;
    if (templateId) {
      console.log(`[RESEND] Using template: ${templateId}`);
      console.log(`[RESEND] RESET_LINK (app deep link): ${resetLink}`);
      console.log(`[RESEND] Web fallback link: ${webLink}`);
      console.log(`[RESEND] Backend fallback link: ${backendRedirectLink}`);
      sendPayload = {
        from: message.from,
        to: message.to,
        subject: message.subject,
        template: {
          id: templateId,
          variables: {
            // Primary — button link (app deep link)
            RESET_LINK: resetLink,
            USER_NAME: userName || "Customer",
            EXPIRY_MINUTES: "60",
            // Token aliases — ensures token is available no matter what variable name your Resend template uses
            TOKEN: resetToken,
            token: resetToken,
            RESET_TOKEN: resetToken,
            resetToken: resetToken,
            RESETTOKEN: resetToken,
            // App / website link aliases (all point to same app deep link)
            APP_LINK: appDeepLink,
            DEEP_LINK: appDeepLink,
            ZEU_LINK: appDeepLink,
            NEXKIRANA_LINK: legacyDeepLink,
            LEGACY_LINK: legacyDeepLink,
            RESET_URL: resetLink,
            RESETLINK: resetLink,
            LINK: resetLink,
            URL: resetLink,
            // Website fallback link (HTTPS) — use for "button not working" copy/paste
            WEB_LINK: webLink,
            WEBSITE_LINK: webLink,
            HTTPS_LINK: webLink,
            FALLBACK_LINK: webLink,
            BACKEND_LINK: backendRedirectLink,
            REDIRECT_LINK: backendRedirectLink,
          },
        },
      };
    } else {
      sendPayload = message;
    }

    const { data, error } = await resend.emails.send(sendPayload);

    if (error) {
      throw new Error(`Resend API error: ${error.message}`);
    }

    console.log(`[RESEND] ✅ Password reset email sent: ${data?.id}`);

    return {
      success: true,
      provider: "resend",
      id: data?.id,
    };
  } catch (error) {
    console.error("[RESEND] ❌ Error sending email:", error.message);

    throw new Error(`Resend email failed: ${error.message}`, {
      cause: error,
    });
  }
};

/**
 * Send password reset confirmation via Resend
 */
export const sendPasswordResetConfirmationResend = async (to, userName) => {
  try {
    const resend = getResend();
    if (!resend) {
      throw new Error("Resend not configured");
    }

    const { data, error } = await resend.emails.send({
      from: getFrom(),
      to: [to],
      subject: "Security Alert: Password Successfully Changed - NexKirana",
      text: `
Dear ${userName || "Customer"},

This email confirms that your NexKirana account password has been successfully changed.

Account Email: ${to}
Changed On: ${new Date().toLocaleString()}

If you did not make this change, please contact our support team immediately at resetnexkirana@gmail.com.

© ${new Date().getFullYear()} NexKirana. All rights reserved.
      `,
      html: `
        <!DOCTYPE html>
        <html>
        <body style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Password Successfully Changed</h2>
          <p>Hello ${userName || "Customer"},</p>
          <p>This confirms that your NexKirana account password has been successfully changed.</p>
          <p><strong>Account:</strong> ${to}<br>
          <strong>Changed:</strong> ${new Date().toLocaleString()}</p>
          <p>If you didn't make this change, contact us immediately at resetnexkirana@gmail.com.</p>
          <p style="color: #777; font-size: 12px;">© ${new Date().getFullYear()} NexKirana</p>
        </body>
        </html>
      `,
    });

    if (error) {
      throw new Error(`Resend API error: ${error.message}`);
    }

    console.log(`[RESEND] ✅ Confirmation email sent: ${data?.id}`);

    return { success: true };
  } catch (error) {
    console.error("[RESEND] ❌ Confirmation email failed:", error.message);
    throw error;
  }
};

export default {
  sendPasswordResetEmailResend,
  sendPasswordResetConfirmationResend,
};
