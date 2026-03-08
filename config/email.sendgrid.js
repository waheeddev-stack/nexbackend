import sgMail from '@sendgrid/mail';

/**
 * SendGrid Email Service
 * Free tier: 100 emails/day
 * Works on Render (uses HTTPS API, not SMTP)
 */

// Initialize SendGrid
const initSendGrid = () => {
  const apiKey = process.env.SENDGRID_API_KEY;
  
  if (!apiKey) {
    console.warn('[SENDGRID] API key not configured. Email sending will fail.');
    return false;
  }
  
  sgMail.setApiKey(apiKey);
  console.log('[SENDGRID] ✅ Initialized successfully');
  return true;
};

/**
 * Send password reset email via SendGrid
 */
export const sendPasswordResetEmailSendGrid = async (to, resetToken, userName) => {
  try {
    console.log(`[SENDGRID] Sending password reset email to: ${to}`);
    
    // Initialize SendGrid
    if (!initSendGrid()) {
      throw new Error('SendGrid not configured. Please set SENDGRID_API_KEY in environment variables.');
    }
    
    // Use HTTPS link that redirects to deep link (works better in emails)
    const backendUrl = process.env.RESET_REDIRECT_URL || process.env.RENDER_EXTERNAL_URL || 'https://nexbackend.onrender.com';
    const resetLink = `${backendUrl}/api/password-reset/redirect?token=${encodeURIComponent(resetToken)}`;
    
    const fromEmail = process.env.SENDGRID_FROM_EMAIL || process.env.EMAIL_USER || 'resetnexkirana@gmail.com';
    const fromName = process.env.SENDGRID_FROM_NAME || 'NexKirana';
    const templateId = process.env.SENDGRID_TEMPLATE_ID;
    
    // If template ID is provided, use dynamic template
    if (templateId) {
      console.log(`[SENDGRID] Using template: ${templateId}`);
      
      const msg = {
        to,
        from: {
          email: fromEmail,
          name: fromName
        },
        templateId: templateId,
        dynamicTemplateData: {
          RESET_LINK: resetLink,
          USER_NAME: userName || 'Customer',
          EXPIRY_MINUTES: '60'
        }
      };

      const startTime = Date.now();
      await sgMail.send(msg);
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      console.log(`[SENDGRID] ✅ Password reset email sent successfully in ${duration}s (using template)`);
      
      return {
        success: true,
        provider: 'sendgrid',
        method: 'template'
      };
    }
    
    // Otherwise, use inline HTML (fallback)
    console.log(`[SENDGRID] Using inline HTML (no template ID configured)`);
    
    const msg = {
      to,
      from: {
        email: fromEmail,
        name: fromName
      },
      subject: 'Password Reset Request - NexKirana Account',
      text: `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                        NEXKIRANA - PASSWORD RESET REQUEST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Dear ${userName || 'Valued Customer'},

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
                        Hello ${userName || 'Customer'},
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
      `
    };

    const startTime = Date.now();
    await sgMail.send(msg);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`[SENDGRID] ✅ Password reset email sent successfully in ${duration}s`);
    
    return {
      success: true,
      provider: 'sendgrid'
    };
  } catch (error) {
    console.error('[SENDGRID] ❌ Error sending email:', error.message);
    
    if (error.response) {
      console.error('[SENDGRID] Error details:', {
        statusCode: error.response.statusCode,
        body: error.response.body
      });
    }
    
    throw new Error(`SendGrid email failed: ${error.message}`);
  }
};

/**
 * Send password reset confirmation via SendGrid
 */
export const sendPasswordResetConfirmationSendGrid = async (to, userName) => {
  try {
    if (!initSendGrid()) {
      throw new Error('SendGrid not configured');
    }
    
    const fromEmail = process.env.SENDGRID_FROM_EMAIL || process.env.EMAIL_USER || 'resetnexkirana@gmail.com';
    const fromName = process.env.SENDGRID_FROM_NAME || 'NexKirana';
    
    const msg = {
      to,
      from: {
        email: fromEmail,
        name: fromName
      },
      subject: 'Security Alert: Password Successfully Changed - NexKirana',
      text: `
Dear ${userName || 'Customer'},

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
          <p>Hello ${userName || 'Customer'},</p>
          <p>This confirms that your NexKirana account password has been successfully changed.</p>
          <p><strong>Account:</strong> ${to}<br>
          <strong>Changed:</strong> ${new Date().toLocaleString()}</p>
          <p>If you didn't make this change, contact us immediately at resetnexkirana@gmail.com.</p>
          <p style="color: #777; font-size: 12px;">© ${new Date().getFullYear()} NexKirana</p>
        </body>
        </html>
      `
    };

    await sgMail.send(msg);
    console.log('[SENDGRID] ✅ Confirmation email sent');
    
    return { success: true };
  } catch (error) {
    console.error('[SENDGRID] ❌ Confirmation email failed:', error.message);
    throw error;
  }
};

export default {
  sendPasswordResetEmailSendGrid,
  sendPasswordResetConfirmationSendGrid
};
