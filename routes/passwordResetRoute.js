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
          userId: user.id,
          email: user.email,
          type: 'password_reset'
        },
        '1h'
      );

      // Send password reset email
      try {
        await sendPasswordResetEmail(user.email, resetToken, user.name);
        console.log(`Password reset email sent to: ${user.email}`);
      } catch (emailError) {
        console.error('Failed to send password reset email:', emailError);
        return res.status(500).json({
          success: false,
          message: 'Failed to send password reset email. Please try again later.'
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
        [payload.userId, payload.email]
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
      [payload.userId, payload.email]
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
