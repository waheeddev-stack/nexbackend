import express from 'express';
import { OAuth2Client } from 'google-auth-library';
import db from '../config/db.js';
import { createJWEToken } from '../utils/jweToken.js';

const router = express.Router();

// Initialize Google OAuth client
const getGoogleClient = () => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID not configured in environment variables');
  }
  return new OAuth2Client(clientId);
};

/**
 * @route   POST /api/user/google-signin
 * @desc    Authenticate user with Google ID token
 * @access  Public
 */
router.post('/google-signin', async (req, res) => {
  try {
    const { idToken, user } = req.body;

    // Validate request
    if (!idToken || !user?.email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: idToken and user.email are required' 
      });
    }

    // Verify Google ID token
    const client = getGoogleClient();
    let googleUser;
    
    try {
      const ticket = await client.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      googleUser = ticket.getPayload();
      
      // Verify email matches
      if (googleUser.email !== user.email) {
        return res.status(401).json({ 
          success: false, 
          message: 'Email mismatch in token verification' 
        });
      }
    } catch (verifyError) {
      console.error('Google token verification failed:', verifyError.message);
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid Google token' 
      });
    }

    // Check if user exists by email or Google ID
    const [existingUsers] = await db.query(
      'SELECT * FROM users WHERE email = ? OR google_id = ?',
      [user.email, user.googleId || googleUser.sub]
    );

    let userId;
    let isNewUser = false;
    let userData;

    if (existingUsers.length > 0) {
      // User exists
      userId = existingUsers[0].id;
      
      // Update Google ID and profile if not set or changed
      await db.query(
        `UPDATE users 
         SET google_id = ?, 
             name = COALESCE(NULLIF(name, ''), ?),
             profile_picture = COALESCE(NULLIF(profile_picture, ''), ?)
         WHERE id = ?`,
        [user.googleId || googleUser.sub, user.name, user.photo, userId]
      );
      
      console.log(`Existing user logged in via Google: ${userId}`);
    } else {
      // Create new user
      const [result] = await db.query(
        `INSERT INTO users (
          email, 
          name, 
          google_id, 
          profile_picture, 
          password, 
          created_at,
          email_verified
        ) VALUES (?, ?, ?, ?, ?, NOW(), 1)`,
        [
          user.email, 
          user.name || googleUser.name, 
          user.googleId || googleUser.sub, 
          user.photo || googleUser.picture, 
          'GOOGLE_AUTH' // Placeholder password for Google users
        ]
      );
      
      userId = result.insertId;
      isNewUser = true;
      
      console.log(`New user created via Google: ${userId}`);
    }

    // Fetch complete user data
    const [userDataResult] = await db.query(
      `SELECT 
        id, 
        email, 
        name, 
        phone, 
        profile_picture,
        address,
        city,
        state,
        pincode,
        created_at
      FROM users 
      WHERE id = ?`,
      [userId]
    );

    if (userDataResult.length === 0) {
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to retrieve user data' 
      });
    }

    userData = userDataResult[0];

    // Generate JWE token (encrypted JWT)
    const token = await createJWEToken(
      { 
        id: userData.id, 
        email: userData.email,
        authMethod: 'google'
      },
      '30d' // 30 days expiration
    );

    // Log successful authentication
    console.log(`Google sign-in successful for user ${userId} (${userData.email})`);

    // Return success response
    res.json({
      success: true,
      token,
      tokenType: 'JWE',
      user: {
        id: userData.id,
        email: userData.email,
        name: userData.name,
        phone: userData.phone,
        profile_picture: userData.profile_picture,
        address: userData.address,
        city: userData.city,
        state: userData.state,
        pincode: userData.pincode,
      },
      isNewUser,
      message: isNewUser ? 'Account created successfully' : 'Welcome back!',
    });

  } catch (error) {
    console.error('Google sign-in error:', error);
    
    // Handle specific errors
    if (error.message.includes('GOOGLE_CLIENT_ID')) {
      return res.status(500).json({ 
        success: false, 
        message: 'Google authentication not configured on server' 
      });
    }
    
    if (error.message.includes('JWT_SECRET')) {
      return res.status(500).json({ 
        success: false, 
        message: 'Authentication system not configured' 
      });
    }

    res.status(500).json({ 
      success: false, 
      message: 'Server error during Google sign-in',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @route   POST /api/user/google-signout
 * @desc    Sign out Google user (optional - mainly client-side)
 * @access  Private
 */
router.post('/google-signout', async (req, res) => {
  try {
    // Optional: Add any server-side cleanup here
    // (e.g., invalidate refresh tokens, log signout event)
    
    res.json({
      success: true,
      message: 'Signed out successfully',
    });
  } catch (error) {
    console.error('Google sign-out error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error during sign-out' 
    });
  }
});

export default router;
