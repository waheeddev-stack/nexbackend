import express from 'express';
import bcrypt from 'bcryptjs';
import pool from '../config/db.js';
import { createJWEToken } from '../utils/jweToken.js';
import { OAuth2Client } from 'google-auth-library';

const router = express.Router();

// Initialize Google OAuth client
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * Verify Google ID token
 */
async function verifyGoogleToken(idToken) {
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    
    const payload = ticket.getPayload();
    return {
      googleId: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
      emailVerified: payload.email_verified,
    };
  } catch (error) {
    console.error('Google token verification failed:', error);
    throw new Error('Invalid Google token');
  }
}

/**
 * @route   POST /api/auth/google/users
 * @desc    Google Sign-In for Users (Customers)
 * @access  Public
 */
router.post('/users', async (req, res) => {
  try {
    const { idToken, expoPushToken } = req.body;

    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: 'Google ID token is required',
      });
    }

    // Verify Google token
    let googleUser;
    try {
      googleUser = await verifyGoogleToken(idToken);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Google token',
      });
    }

    // Check if user exists with this Google ID
    let [users] = await pool.query(
      'SELECT * FROM users WHERE google_id = ?',
      [googleUser.googleId]
    );

    let user;

    if (users.length > 0) {
      // User exists - update last login and push token
      user = users[0];
      
      const updateFields = [];
      const updateValues = [];
      
      if (expoPushToken) {
        updateFields.push('expo_push_token = ?');
        updateValues.push(expoPushToken);
      }
      
      if (updateFields.length > 0) {
        updateValues.push(user.id);
        await pool.query(
          `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
          updateValues
        );
      }

      console.log(`Google Sign-In: Existing user ${user.email}`);
    } else {
      // Check if email already exists (user might have signed up with email/password)
      [users] = await pool.query(
        'SELECT * FROM users WHERE email = ?',
        [googleUser.email]
      );

      if (users.length > 0) {
        // Link Google account to existing email account
        user = users[0];
        
        await pool.query(
          'UPDATE users SET google_id = ?, img = ?, expo_push_token = ? WHERE id = ?',
          [googleUser.googleId, googleUser.picture || user.img, expoPushToken || user.expo_push_token, user.id]
        );

        console.log(`Google Sign-In: Linked Google account to existing user ${user.email}`);
      } else {
        // Create new user
        const [result] = await pool.query(
          `INSERT INTO users (name, email, password, google_id, img, expo_push_token) 
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            googleUser.name,
            googleUser.email,
            await bcrypt.hash(Math.random().toString(36), 10), // Random password for Google users
            googleUser.googleId,
            googleUser.picture || null,
            expoPushToken || null,
          ]
        );

        user = {
          id: result.insertId,
          name: googleUser.name,
          email: googleUser.email,
          google_id: googleUser.googleId,
          img: googleUser.picture,
          phone: null,
          address: null,
          store_credits: 0,
          latitude: null,
          longitude: null,
        };

        console.log(`Google Sign-In: New user created ${user.email}`);
      }
    }

    // Generate tokens
    const accessToken = await createJWEToken({ id: user.id, role: 'user' }, '7d');
    const refreshToken = await createJWEToken({ id: user.id, role: 'user', type: 'refresh' }, '30d');

    // Save refresh token
    await pool.query(
      'UPDATE users SET refresh_token = ? WHERE id = ?',
      [refreshToken, user.id]
    );

    // Return user data and tokens
    res.json({
      success: true,
      message: 'Google Sign-In successful',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        address: user.address,
        img: user.img,
        store_credits: user.store_credits,
        latitude: user.latitude,
        longitude: user.longitude,
      },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error('Google Sign-In error (users):', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred during Google Sign-In',
    });
  }
});

/**
 * @route   POST /api/auth/google/shopkeepers
 * @desc    Google Sign-In for Shopkeepers
 * @access  Public
 */
router.post('/shopkeepers', async (req, res) => {
  try {
    const { idToken, expoPushToken } = req.body;

    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: 'Google ID token is required',
      });
    }

    // Verify Google token
    let googleUser;
    try {
      googleUser = await verifyGoogleToken(idToken);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Google token',
      });
    }

    // Check if shopkeeper exists with this Google ID
    let [shopkeepers] = await pool.query(
      'SELECT * FROM shopkeepers WHERE google_id = ?',
      [googleUser.googleId]
    );

    let shopkeeper;

    if (shopkeepers.length > 0) {
      // Shopkeeper exists - update push token
      shopkeeper = shopkeepers[0];
      
      if (expoPushToken) {
        await pool.query(
          'UPDATE shopkeepers SET expo_push_token = ? WHERE id = ?',
          [expoPushToken, shopkeeper.id]
        );
      }

      console.log(`Google Sign-In: Existing shopkeeper ${shopkeeper.email}`);
    } else {
      // Check if email already exists
      [shopkeepers] = await pool.query(
        'SELECT * FROM shopkeepers WHERE email = ?',
        [googleUser.email]
      );

      if (shopkeepers.length > 0) {
        // Link Google account to existing email account
        shopkeeper = shopkeepers[0];
        
        await pool.query(
          'UPDATE shopkeepers SET google_id = ?, img = ?, expo_push_token = ? WHERE id = ?',
          [googleUser.googleId, googleUser.picture || shopkeeper.img, expoPushToken || shopkeeper.expo_push_token, shopkeeper.id]
        );

        console.log(`Google Sign-In: Linked Google account to existing shopkeeper ${shopkeeper.email}`);
      } else {
        // For shopkeepers, we require additional info (shop_name, phone, etc.)
        // So we don't auto-create - return a special response
        return res.status(202).json({
          success: false,
          code: 'REGISTRATION_REQUIRED',
          message: 'Please complete your shopkeeper registration',
          googleUser: {
            googleId: googleUser.googleId,
            email: googleUser.email,
            name: googleUser.name,
            picture: googleUser.picture,
          },
        });
      }
    }

    // Generate tokens
    const accessToken = await createJWEToken({ id: shopkeeper.id, role: 'shopkeeper' }, '7d');
    const refreshToken = await createJWEToken({ id: shopkeeper.id, role: 'shopkeeper', type: 'refresh' }, '30d');

    // Save refresh token
    await pool.query(
      'UPDATE shopkeepers SET refresh_token = ? WHERE id = ?',
      [refreshToken, shopkeeper.id]
    );

    // Return shopkeeper data and tokens
    res.json({
      success: true,
      message: 'Google Sign-In successful',
      shopkeeper: {
        id: shopkeeper.id,
        name: shopkeeper.name,
        shop_name: shopkeeper.shop_name,
        email: shopkeeper.email,
        phone: shopkeeper.phone,
        address: shopkeeper.address,
        img: shopkeeper.img,
        latitude: shopkeeper.latitude,
        longitude: shopkeeper.longitude,
        is_online: shopkeeper.is_online,
        subscription_status: shopkeeper.subscription_status,
      },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error('Google Sign-In error (shopkeepers):', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred during Google Sign-In',
    });
  }
});

/**
 * @route   POST /api/auth/google/shopkeepers/register
 * @desc    Complete shopkeeper registration with Google
 * @access  Public
 */
router.post('/shopkeepers/register', async (req, res) => {
  try {
    const { idToken, shopName, phone, address, latitude, longitude, expoPushToken } = req.body;

    if (!idToken || !shopName || !phone) {
      return res.status(400).json({
        success: false,
        message: 'Google token, shop name, and phone are required',
      });
    }

    // Verify Google token
    let googleUser;
    try {
      googleUser = await verifyGoogleToken(idToken);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Google token',
      });
    }

    // Check if shopkeeper already exists
    const [existing] = await pool.query(
      'SELECT id FROM shopkeepers WHERE google_id = ? OR email = ?',
      [googleUser.googleId, googleUser.email]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Account already exists. Please sign in instead.',
      });
    }

    // Create new shopkeeper
    const [result] = await pool.query(
      `INSERT INTO shopkeepers 
       (name, shop_name, email, password, phone, address, google_id, img, latitude, longitude, expo_push_token) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        googleUser.name,
        shopName,
        googleUser.email,
        await bcrypt.hash(Math.random().toString(36), 10), // Random password
        phone,
        address || null,
        googleUser.googleId,
        googleUser.picture || null,
        latitude || null,
        longitude || null,
        expoPushToken || null,
      ]
    );

    const shopkeeper = {
      id: result.insertId,
      name: googleUser.name,
      shop_name: shopName,
      email: googleUser.email,
      phone,
      address,
      img: googleUser.picture,
      latitude,
      longitude,
      is_online: 0,
      subscription_status: 'trial',
    };

    // Generate tokens
    const accessToken = await createJWEToken({ id: shopkeeper.id, role: 'shopkeeper' }, '7d');
    const refreshToken = await createJWEToken({ id: shopkeeper.id, role: 'shopkeeper', type: 'refresh' }, '30d');

    // Save refresh token
    await pool.query(
      'UPDATE shopkeepers SET refresh_token = ? WHERE id = ?',
      [refreshToken, shopkeeper.id]
    );

    console.log(`Google Sign-Up: New shopkeeper created ${shopkeeper.email}`);

    res.status(201).json({
      success: true,
      message: 'Shopkeeper registration successful',
      shopkeeper,
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error('Google shopkeeper registration error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred during registration',
    });
  }
});

export default router;
