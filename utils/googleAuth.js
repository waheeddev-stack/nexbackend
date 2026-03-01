import { OAuth2Client } from 'google-auth-library';
import dotenv from 'dotenv';

dotenv.config();

// Support multiple client IDs for different apps
const NEXKIRANA_CLIENT_ID = '664815906028-2sj6e86rgl9njt5m884l66i99je06esj.apps.googleusercontent.com';
const SHOPKEEPER_CLIENT_ID = '664815906028-2fkqn0bd9dqbk09g452v3n0nkq723a9r.apps.googleusercontent.com';

const client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID || SHOPKEEPER_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_CALLBACK_URL
);

/**
 * Verify Google ID token
 * @param {string} token - Google ID token from client
 * @param {string} userType - 'user' or 'shopkeeper' to determine which client ID to use
 * @returns {Promise<Object>} User info from Google
 */
export async function verifyGoogleToken(token, userType = 'shopkeeper') {
  try {
    // Determine which client ID to use based on user type
    const clientId = userType === 'user' ? NEXKIRANA_CLIENT_ID : SHOPKEEPER_CLIENT_ID;
    
    // Try to verify with the appropriate client ID
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: clientId,
    });
    
    const payload = ticket.getPayload();
    
    return {
      googleId: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
      emailVerified: payload.email_verified
    };
  } catch (error) {
    console.error('Google token verification error:', error);
    throw new Error('Invalid Google token');
  }
}

/**
 * Generate Google OAuth URL for authorization
 * @param {string} userType - 'user' or 'shopkeeper'
 * @returns {string} Authorization URL
 */
export function getGoogleAuthUrl(userType = 'user') {
  const scopes = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
  ];

  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    state: userType, // Pass user type in state
  });

  return authUrl;
}

/**
 * Exchange authorization code for tokens
 * @param {string} code - Authorization code from Google
 * @returns {Promise<Object>} Tokens and user info
 */
export async function getGoogleTokens(code) {
  try {
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    // Get user info
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    return {
      tokens,
      userInfo: {
        googleId: payload.sub,
        email: payload.email,
        name: payload.name,
        picture: payload.picture,
        emailVerified: payload.email_verified
      }
    };
  } catch (error) {
    console.error('Google token exchange error:', error);
    throw new Error('Failed to exchange Google authorization code');
  }
}
