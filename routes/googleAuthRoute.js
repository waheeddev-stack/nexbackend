import express from 'express';
import pool from '../config/db.js';
import { verifyGoogleToken, getGoogleAuthUrl, getGoogleTokens } from '../utils/googleAuth.js';
import { createJWEToken } from '../utils/jweToken.js';

const googleAuthRouter = express.Router();

/**
 * GET /api/auth/google/url
 * Get Google OAuth authorization URL
 */
googleAuthRouter.get('/google/url', (req, res) => {
  try {
    const { userType } = req.query; // 'user' or 'shopkeeper'
    
    if (!userType || !['user', 'shopkeeper'].includes(userType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or missing userType. Must be "user" or "shopkeeper"'
      });
    }

    const authUrl = getGoogleAuthUrl(userType);
    
    res.json({
      success: true,
      authUrl
    });
  } catch (error) {
    console.error('Google auth URL error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate Google auth URL'
    });
  }
});

/**
 * GET /api/auth/google/callback
 * Google OAuth callback endpoint
 */
googleAuthRouter.get('/google/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    
    if (!code) {
      return res.status(400).json({
        success: false,
        message: 'Authorization code is required'
      });
    }

    const userType = state || 'user'; // Default to 'user' if state not provided

    // Exchange code for tokens and user info
    const { userInfo } = await getGoogleTokens(code);

    // Check if user exists
    const tableName = userType === 'shopkeeper' ? 'shopkeepers' : 'users';
    const [existingUser] = await pool.query(
      `SELECT * FROM ${tableName} WHERE email = ?`,
      [userInfo.email]
    );

    let user;
    let isNewUser = false;

    if (existingUser.length > 0) {
      // User exists, update Google ID and picture if needed
      user = existingUser[0];
      
      await pool.query(
        `UPDATE ${tableName} SET google_id = ?, img = ? WHERE id = ?`,
        [userInfo.googleId, userInfo.picture, user.id]
      );
    } else {
      // Create new user
      isNewUser = true;
      
      // Get next ID
      const [maxIdResult] = await pool.query(`SELECT MAX(id) as maxId FROM ${tableName}`);
      const nextId = (maxIdResult[0].maxId || 0) + 1;

      // Insert new user
      if (userType === 'shopkeeper') {
        await pool.query(
          `INSERT INTO ${tableName} (id, name, email, google_id, img, shop_name) VALUES (?, ?, ?, ?, ?, ?)`,
          [nextId, userInfo.name, userInfo.email, userInfo.googleId, userInfo.picture, `${userInfo.name}'s Shop`]
        );
      } else {
        await pool.query(
          `INSERT INTO ${tableName} (id, name, email, google_id, img) VALUES (?, ?, ?, ?, ?)`,
          [nextId, userInfo.name, userInfo.email, userInfo.googleId, userInfo.picture]
        );
      }

      // Fetch newly created user
      const [newUser] = await pool.query(`SELECT * FROM ${tableName} WHERE id = ?`, [nextId]);
      user = newUser[0];
    }

    // Generate JWE token
    const token = await createJWEToken({
      id: user.id,
      role: userType,
      email: user.email
    }, '7d');

    // Return success response
    res.json({
      success: true,
      token,
      tokenType: 'JWE',
      isNewUser,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.img
      }
    });

  } catch (error) {
    console.error('Google callback error:', error);
    res.status(500).json({
      success: false,
      message: 'Google authentication failed'
    });
  }
});

/**
 * POST /api/auth/google/verify
 * Verify Google ID token (for mobile apps)
 */
googleAuthRouter.post('/google/verify', async (req, res) => {
  try {
    const { idToken, userType } = req.body;

    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: 'Google ID token is required'
      });
    }

    if (!userType || !['user', 'shopkeeper'].includes(userType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or missing userType. Must be "user" or "shopkeeper"'
      });
    }

    // Verify Google token
    const userInfo = await verifyGoogleToken(idToken);

    // Check if user exists
    const tableName = userType === 'shopkeeper' ? 'shopkeepers' : 'users';
    const [existingUser] = await pool.query(
      `SELECT * FROM ${tableName} WHERE email = ?`,
      [userInfo.email]
    );

    let user;
    let isNewUser = false;

    if (existingUser.length > 0) {
      // User exists
      user = existingUser[0];
      
      // Update Google ID and picture
      await pool.query(
        `UPDATE ${tableName} SET google_id = ?, img = ? WHERE id = ?`,
        [userInfo.googleId, userInfo.picture, user.id]
      );
    } else {
      // Create new user
      isNewUser = true;
      
      // Get next ID
      const [maxIdResult] = await pool.query(`SELECT MAX(id) as maxId FROM ${tableName}`);
      const nextId = (maxIdResult[0].maxId || 0) + 1;

      // Insert new user
      if (userType === 'shopkeeper') {
        await pool.query(
          `INSERT INTO ${tableName} (id, name, email, google_id, img, shop_name) VALUES (?, ?, ?, ?, ?, ?)`,
          [nextId, userInfo.name, userInfo.email, userInfo.googleId, userInfo.picture, `${userInfo.name}'s Shop`]
        );
      } else {
        await pool.query(
          `INSERT INTO ${tableName} (id, name, email, google_id, img) VALUES (?, ?, ?, ?, ?)`,
          [nextId, userInfo.name, userInfo.email, userInfo.googleId, userInfo.picture]
        );
      }

      // Fetch newly created user
      const [newUser] = await pool.query(`SELECT * FROM ${tableName} WHERE id = ?`, [nextId]);
      user = newUser[0];
    }

    // Generate JWE token
    const token = await createJWEToken({
      id: user.id,
      role: userType,
      email: user.email
    }, '7d');

    res.json({
      success: true,
      token,
      tokenType: 'JWE',
      isNewUser,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.img
      }
    });

  } catch (error) {
    console.error('Google verify error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Google authentication failed'
    });
  }
});

export default googleAuthRouter;
