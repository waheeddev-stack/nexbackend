import nodemailer from 'nodemailer';
import { getConfig } from './environment.js';

const config = getConfig();

/**
 * Create email transporter for sending emails
 */
const createTransporter = () => {
  // Gmail configuration
  const transporter = nodemailer.createTransporter({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER || 'nexkiranaofficial@gmail.com',
      pass: process.env.EMAIL_PASSWORD, // App-specific password
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  return transporter;
};

/**
 * Send password reset email
 * @param {string} to - Recipient email
 * @param {string} resetToken - Password reset token
 * @param {string} userName - User's name
 * @returns {Promise<Object>} Email send result
 */
export const sendPasswordResetEmail = async (to, resetToken, userName) => {
  try {
    const transporter = createTransporter();
    
    // Create reset link (adjust URL based on your app's deep linking setup)
    const resetLink = `nexkirana://reset-password?token=${resetToken}`;
    
    const mailOptions = {
      from: {
        name: 'NexKirana',
        address: process.env.EMAIL_USER || 'nexkiranaofficial@gmail.com'
      },
      to,
      subject: 'Reset Your NexKirana Password',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Reset Your Password</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                  <!-- Header -->
                  <tr>
                    <td style="background: linear-gradient(135deg, #00A6CB 0%, #0088A8 100%); padding: 40px 20px; text-align: center;">
                      <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold;">NexKirana</h1>
                    </td>
                  </tr>
                  
                  <!-- Content -->
                  <tr>
                    <td style="padding: 40px 30px;">
                      <h2 style="color: #333333; margin: 0 0 20px 0; font-size: 24px;">Reset Your Password</h2>
                      <p style="color: #666666; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                        Hi ${userName || 'there'},
                      </p>
                      <p style="color: #666666; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                        We received a request to reset your password for your NexKirana account. Click the button below to create a new password:
                      </p>
                      
                      <!-- Reset Button -->
                      <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
                        <tr>
                          <td align="center">
                            <a href="${resetLink}" style="display: inline-block; background-color: #00A6CB; color: #ffffff; text-decoration: none; padding: 14px 40px; border-radius: 6px; font-size: 16px; font-weight: bold;">Reset Password</a>
                          </td>
                        </tr>
                      </table>
                      
                      <p style="color: #666666; font-size: 14px; line-height: 1.6; margin: 20px 0 0 0;">
                        Or copy and paste this link into your browser:
                      </p>
                      <p style="color: #00A6CB; font-size: 14px; word-break: break-all; margin: 10px 0 20px 0;">
                        ${resetLink}
                      </p>
                      
                      <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
                        <p style="color: #856404; font-size: 14px; margin: 0; line-height: 1.6;">
                          <strong>Security Notice:</strong> This link will expire in 1 hour. If you didn't request a password reset, please ignore this email or contact support if you have concerns.
                        </p>
                      </div>
                    </td>
                  </tr>
                  
                  <!-- Footer -->
                  <tr>
                    <td style="background-color: #f8f9fa; padding: 30px; text-align: center; border-top: 1px solid #e9ecef;">
                      <p style="color: #6c757d; font-size: 14px; margin: 0 0 10px 0;">
                        Need help? Contact us at <a href="mailto:nexkiranaofficial@gmail.com" style="color: #00A6CB; text-decoration: none;">nexkiranaofficial@gmail.com</a>
                      </p>
                      <p style="color: #6c757d; font-size: 12px; margin: 0;">
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
      text: `
        Reset Your Password
        
        Hi ${userName || 'there'},
        
        We received a request to reset your password for your NexKirana account.
        
        Click this link to reset your password: ${resetLink}
        
        This link will expire in 1 hour.
        
        If you didn't request a password reset, please ignore this email.
        
        Need help? Contact us at nexkiranaofficial@gmail.com
        
        © ${new Date().getFullYear()} NexKirana. All rights reserved.
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Password reset email sent:', info.messageId);
    
    return {
      success: true,
      messageId: info.messageId
    };
  } catch (error) {
    console.error('Error sending password reset email:', error);
    throw new Error('Failed to send password reset email');
  }
};

/**
 * Send password reset confirmation email
 * @param {string} to - Recipient email
 * @param {string} userName - User's name
 * @returns {Promise<Object>} Email send result
 */
export const sendPasswordResetConfirmation = async (to, userName) => {
  try {
    const transporter = createTransporter();
    
    const mailOptions = {
      from: {
        name: 'NexKirana',
        address: process.env.EMAIL_USER || 'nexkiranaofficial@gmail.com'
      },
      to,
      subject: 'Your NexKirana Password Has Been Reset',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Password Reset Successful</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                  <tr>
                    <td style="background: linear-gradient(135deg, #28a745 0%, #20883a 100%); padding: 40px 20px; text-align: center;">
                      <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold;">✓ Password Reset Successful</h1>
                    </td>
                  </tr>
                  
                  <tr>
                    <td style="padding: 40px 30px;">
                      <p style="color: #666666; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                        Hi ${userName || 'there'},
                      </p>
                      <p style="color: #666666; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                        Your NexKirana password has been successfully reset. You can now sign in with your new password.
                      </p>
                      
                      <div style="background-color: #d1ecf1; border-left: 4px solid #0c5460; padding: 15px; margin: 20px 0;">
                        <p style="color: #0c5460; font-size: 14px; margin: 0; line-height: 1.6;">
                          <strong>Security Tip:</strong> If you didn't make this change, please contact our support team immediately at nexkiranaofficial@gmail.com
                        </p>
                      </div>
                    </td>
                  </tr>
                  
                  <tr>
                    <td style="background-color: #f8f9fa; padding: 30px; text-align: center; border-top: 1px solid #e9ecef;">
                      <p style="color: #6c757d; font-size: 14px; margin: 0 0 10px 0;">
                        Need help? Contact us at <a href="mailto:nexkiranaofficial@gmail.com" style="color: #00A6CB; text-decoration: none;">nexkiranaofficial@gmail.com</a>
                      </p>
                      <p style="color: #6c757d; font-size: 12px; margin: 0;">
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
      text: `
        Password Reset Successful
        
        Hi ${userName || 'there'},
        
        Your NexKirana password has been successfully reset. You can now sign in with your new password.
        
        If you didn't make this change, please contact our support team immediately at nexkiranaofficial@gmail.com
        
        © ${new Date().getFullYear()} NexKirana. All rights reserved.
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Password reset confirmation email sent:', info.messageId);
    
    return {
      success: true,
      messageId: info.messageId
    };
  } catch (error) {
    console.error('Error sending confirmation email:', error);
    throw new Error('Failed to send confirmation email');
  }
};

export default {
  sendPasswordResetEmail,
  sendPasswordResetConfirmation
};
