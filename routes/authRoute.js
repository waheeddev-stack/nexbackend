import express from "express";
import verifyToken, { blacklistToken } from "../middleware/auth.js";
import { refreshTokenIfNeeded, handleTokenExpiredError, autoLogoutOnExpiredToken } from "../middleware/tokenRefresh.js";

const authRouter = express.Router();

// Logout route - blacklist the current token
authRouter.post("/logout", verifyToken, async (req, res) => {
  try {
    const token = req.token;
    
    if (token) {
      // Add token to blacklist
      blacklistToken(token);
    }
    
    res.json({
      success: true,
      message: "Logged out successfully",
      action: "CLEAR_STORAGE",
      clearStorage: ['token', 'refreshToken', 'user', 'shopkeeper', 'admin']
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: "Error during logout",
      action: "CLEAR_STORAGE_ANYWAY"
    });
  }
});

// Token validation endpoint
authRouter.get("/validate-token", verifyToken, async (req, res) => {
  try {
    res.json({
      success: true,
      valid: true,
      user: {
        id: req.user.id,
        role: req.user.role,
        exp: req.user.exp,
        timeUntilExpiry: Math.floor((req.user.exp - Date.now() / 1000) / 60) // minutes
      }
    });
  } catch (error) {
    console.error('Token validation error:', error);
    res.status(401).json({
      success: false,
      valid: false,
      message: "Invalid token",
      action: "REDIRECT_TO_LOGIN"
    });
  }
});

// Refresh token endpoint
authRouter.post("/refresh-token", refreshTokenIfNeeded, async (req, res) => {
  try {
    const newToken = res.get('X-New-Token');
    
    if (newToken) {
      res.json({
        success: true,
        token: newToken,
        tokenType: 'JWE',
        message: "Token refreshed successfully"
      });
    } else {
      res.json({
        success: true,
        message: "Token refresh not needed"
      });
    }
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({
      success: false,
      message: "Error refreshing token"
    });
  }
});

// Global error handler for token expiration
authRouter.use(handleTokenExpiredError);
authRouter.use(autoLogoutOnExpiredToken);

export default authRouter;