import express from 'express';
import bcrypt from 'bcryptjs';
import pool from '../config/db.js';
import { createJWEToken, verifyJWEToken } from '../utils/jweToken.js';
import { sendPasswordResetEmail, sendPasswordResetConfirmation } from '../config/email.js';
import { validateEmail, validatePassword } from '../middleware/validation.js';

const router = express.Router();

// Rate limiting for password reset (prevent abuse)
const resetAttempts = new Map();
const MAX_ATTEMPTS = 3;
const ATTEMPT_WINDOW = 15 * 60 * 1000; // 15 minutes

const checkRateLimit = (email) => {
  const now = Date.now();
  const attempts = resetAttempts.get(email) || { count: 0, firstAttempt: now };
  
  // Reset if window expired
  if (now - attempts.firstAttempt > ATTEMPT_WINDOW) {
    resetAttempts.set(email, { count: 1, firstAttempt: now });
    return true;
  }
  
  // Check if exceeded
  if (attempts.count >= MAX_ATTEMPTS) {
    return false;
  }
  
  // Increment
  resetAttempts.set(email, { count: attempts.count + 1, firstAttempt: attempts.firstAttempt });
  return true;
};

/**
 * @route   POST /api/password-reset/request
 * @desc    Request password reset email
 * @access  Public
 */
router.post('/request', async (req, res) => {
  try {
    const { email } = req.body;

    // Validate email
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    let validatedEmail;
    try {
      validatedEmail = validateEmail(email);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    // Check rate limiting
    if (!checkRateLimit(validatedEmail)) {
      return res.status(429).json({
        success: false,
        message: 'Too many password reset attempts. Please try again in 15 minutes.'
      });
    }

    // Check if user exists
    const [users] = await pool.query(
      'SELECT id, name, email FROM users WHERE email = ?',
      [validatedEmail]
    );

    // Always return success to prevent email enumeration
    // But only send email if user exists
    if (users.length > 0) {
      const user = users[0];

      // Create reset token (expires in 1 hour)
      const resetToken = await createJWEToken(
        {
          id: user.id,
          email: user.email,
          type: 'password_reset'
        },
        '1h'
      );

      // Send password reset email
      try {
        console.log(`[PASSWORD-RESET] Sending reset email to: ${user.email}`);
        
        // Add timeout wrapper for the entire email operation
        const emailPromise = sendPasswordResetEmail(user.email, resetToken, user.name);
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Email operation timeout')), 25000); // 25 second timeout
        });
        
        await Promise.race([emailPromise, timeoutPromise]);
        
        console.log(`[PASSWORD-RESET] ✅ Password reset email sent successfully to: ${user.email}`);
      } catch (emailError) {
        console.error('[PASSWORD-RESET] ❌ Failed to send password reset email:', emailError.message);
        console.error('[PASSWORD-RESET] Error details:', emailError);
        
        // Return more specific error message
        let errorMessage = 'Failed to send password reset email. Please try again later.';
        if (emailError.message.includes('authentication')) {
          errorMessage = 'Email service is temporarily unavailable. Please contact support.';
        } else if (emailError.message.includes('connect')) {
          errorMessage = 'Unable to reach email service. Please try again in a few minutes.';
        }
        
        return res.status(500).json({
          success: false,
          message: errorMessage
        });
      }
    } else {
      console.log(`Password reset requested for non-existent email: ${validatedEmail}`);
    }

    // Always return success message
    res.json({
      success: true,
      message: 'If an account exists with this email, you will receive a password reset link shortly.'
    });

  } catch (error) {
    console.error('Password reset request error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while processing your request'
    });
  }
});

/**
 * @route   POST /api/password-reset/verify
 * @desc    Verify reset token validity
 * @access  Public
 */
router.post('/verify', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Reset token is required'
      });
    }

    // Verify token
    try {
      const payload = await verifyJWEToken(token);

      // Check token type
      if (payload.type !== 'password_reset') {
        return res.status(400).json({
          success: false,
          message: 'Invalid reset token'
        });
      }

      // Check if user still exists
      const [users] = await pool.query(
        'SELECT id, email FROM users WHERE id = ? AND email = ?',
        [payload.id, payload.email]
      );

      if (users.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      res.json({
        success: true,
        message: 'Token is valid',
        email: payload.email
      });

    } catch (verifyError) {
      if (verifyError.message === 'TOKEN_EXPIRED') {
        return res.status(401).json({
          success: false,
          message: 'Reset link has expired. Please request a new one.',
          code: 'TOKEN_EXPIRED'
        });
      }

      return res.status(401).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

  } catch (error) {
    console.error('Token verification error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while verifying the token'
    });
  }
});

/**
 * @route   POST /api/password-reset/reset
 * @desc    Reset password with token
 * @access  Public
 */
router.post('/reset', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    // Validate inputs
    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Token and new password are required'
      });
    }

    // Validate password
    try {
      validatePassword(newPassword);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    // Verify token
    let payload;
    try {
      payload = await verifyJWEToken(token);

      // Check token type
      if (payload.type !== 'password_reset') {
        return res.status(400).json({
          success: false,
          message: 'Invalid reset token'
        });
      }
    } catch (verifyError) {
      if (verifyError.message === 'TOKEN_EXPIRED') {
        return res.status(401).json({
          success: false,
          message: 'Reset link has expired. Please request a new one.',
          code: 'TOKEN_EXPIRED'
        });
      }

      return res.status(401).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    // Get user
    const [users] = await pool.query(
      'SELECT id, email, name, password FROM users WHERE id = ? AND email = ?',
      [payload.id, payload.email]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = users[0];

    // Check if new password is same as old password
    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      return res.status(400).json({
        success: false,
        message: 'New password must be different from your current password'
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update password
    await pool.query(
      'UPDATE users SET password = ? WHERE id = ?',
      [hashedPassword, user.id]
    );

    // Send confirmation email
    try {
      await sendPasswordResetConfirmation(user.email, user.name);
    } catch (emailError) {
      console.error('Failed to send confirmation email:', emailError);
      // Don't fail the request if confirmation email fails
    }

    console.log(`Password reset successful for user: ${user.email}`);

    res.json({
      success: true,
      message: 'Password has been reset successfully. You can now sign in with your new password.'
    });

  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while resetting your password'
    });
  }
});

export default router;

/**
 * @route   GET /api/password-reset/redirect
 * @desc    Redirect to app deep link for password reset (email link handler)
 * @access  Public
 */
router.get('/redirect', (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Invalid Reset Link</title>
      </head>
      <body style="font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
        <div style="background: white; padding: 40px; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); max-width: 400px; text-align: center;">
          <div style="font-size: 64px; margin-bottom: 20px;">⚠️</div>
          <h1 style="color: #333; margin: 0 0 10px 0; font-size: 24px;">Invalid Reset Link</h1>
          <p style="color: #666; line-height: 1.6; margin: 0;">This password reset link is invalid. Please request a new one from the app.</p>
        </div>
      </body>
      </html>
    `);
  }

  const deepLink = `nexkirana://reset-password?token=${encodeURIComponent(token)}`;

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Opening NexKirana App...</title>
    </head>
    <body style="font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
      <div style="background: white; padding: 40px; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); max-width: 500px; text-align: center;">
        <div style="border: 4px solid #f3f3f3; border-top: 4px solid #667eea; border-radius: 50%; width: 50px; height: 50px; animation: spin 1s linear infinite; margin: 0 auto 20px;"></div>
        <h1 style="color: #333; margin: 0 0 10px 0; font-size: 24px;">Opening NexKirana App...</h1>
        <p style="color: #666; line-height: 1.6; margin: 0 0 20px 0;">Please wait while we redirect you to the app.</p>
        <a href="${deepLink}" style="display: inline-block; background: #667eea; color: white; padding: 12px 30px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-top: 10px;">Open App Manually</a>
        <div id="instructions" style="margin-top: 30px; padding: 20px; background: #f8f9fa; border-radius: 8px; text-align: left; display: none;">
          <h2 style="font-size: 16px; margin: 0 0 10px 0; color: #333;">App Not Opening?</h2>
          <ol style="margin: 0; padding-left: 20px; color: #666;">
            <li style="margin-bottom: 8px;">Make sure the NexKirana app is installed</li>
            <li style="margin-bottom: 8px;">Click "Open App Manually" above</li>
            <li style="margin-bottom: 8px;">Still having issues? Request a new reset from the app</li>
          </ol>
        </div>
      </div>
      <style>
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      </style>
      <script>
        window.location.href = '${deepLink}';
        setTimeout(function() {
          document.getElementById('instructions').style.display = 'block';
        }, 3000);
        document.querySelector('a').addEventListener('click', function(e) {
          e.preventDefault();
          window.location.href = '${deepLink}';
          setTimeout(function() {
            document.getElementById('instructions').style.display = 'block';
          }, 1000);
        });
      </script>
    </body>
    </html>
  `);
});
