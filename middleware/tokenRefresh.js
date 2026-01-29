import { 
  verifyJWEToken, 
  extractTokenFromHeader, 
  refreshTokenIfNeeded as refreshJWEToken,
  createJWEToken 
} from "../utils/jweToken.js";

// Enhanced token refresh middleware for JWE
export const refreshTokenIfNeeded = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return next();
    }

    const token = extractTokenFromHeader(authHeader);
    
    if (!token) {
      return next();
    }

    try {
      // Verify and decrypt the JWE token
      const payload = await verifyJWEToken(token);
      
      if (!payload || !payload.exp) {
        return next();
      }

      const currentTime = Math.floor(Date.now() / 1000);
      const timeUntilExpiry = payload.exp - currentTime;
      
      // If token expires within 24 hours, generate new token
      if (timeUntilExpiry < 24 * 60 * 60 && timeUntilExpiry > 0) {
        const newToken = await createJWEToken(
          { 
            id: payload.id, 
            role: payload.role 
          }, 
          '7d'
        );
        
        // Add new token to response headers
        res.set('X-New-Token', newToken);
        res.set('X-Token-Refresh', 'true');
        res.set('X-Token-Expires-In', Math.floor(timeUntilExpiry / 3600) + 'h');
        res.set('X-Token-Type', 'JWE');
      }
      
    } catch (tokenError) {
      // If token is invalid or expired, don't break the request
      // Just continue without refresh
      console.log('Token refresh skipped due to token error:', tokenError.message);
    }
    
    next();
  } catch (error) {
    console.error('Token refresh middleware error:', error);
    next();
  }
};

// Enhanced error response for expired tokens
export const handleTokenExpiredError = (error, req, res, next) => {
  if (error.message === 'TOKEN_EXPIRED' || error.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: "Your session has expired. Please login again.",
      code: "TOKEN_EXPIRED",
      action: "REDIRECT_TO_LOGIN",
      timestamp: new Date().toISOString()
    });
  }
  
  if (error.message === 'TOKEN_REVOKED') {
    return res.status(401).json({
      success: false,
      message: "Your session has been revoked. Please login again.",
      code: "TOKEN_REVOKED",
      action: "REDIRECT_TO_LOGIN",
      timestamp: new Date().toISOString()
    });
  }
  
  next(error);
};

// Middleware to handle automatic logout on token expiration
export const autoLogoutOnExpiredToken = (req, res, next) => {
  // This middleware can be used to automatically handle logout
  // when token expiration is detected
  const originalJson = res.json;
  
  res.json = function(data) {
    // If response indicates token expiration, add logout instructions
    if (data && data.code === 'TOKEN_EXPIRED') {
      data.autoLogout = true;
      data.clearStorage = ['token', 'refreshToken', 'user'];
      data.redirectTo = '/login';
    }
    
    return originalJson.call(this, data);
  };
  
  next();
};