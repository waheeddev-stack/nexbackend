/**
 * Client-side token handler utility for React Native apps
 * This file should be copied to your React Native projects
 */

// Token storage keys
const TOKEN_KEY = "jwe_token";
const USER_KEY = "user_data";
const TOKEN_EXPIRY_KEY = "token_expiry";

/**
 * Store token and user data
 */
export const storeAuthData = async (token, user, AsyncStorage) => {
  try {
    await AsyncStorage.setItem(TOKEN_KEY, token);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));

    // Decode token to get expiry (client-side estimation)
    const payload = parseJWTPayload(token);
    if (payload && payload.exp) {
      await AsyncStorage.setItem(TOKEN_EXPIRY_KEY, payload.exp.toString());
    }
  } catch (error) {
    console.error("Error storing auth data:", error);
  }
};

/**
 * Get stored token
 */
export const getStoredToken = async (AsyncStorage) => {
  try {
    return await AsyncStorage.getItem(TOKEN_KEY);
  } catch (error) {
    console.error("Error getting stored token:", error);
    return null;
  }
};

/**
 * Get stored user data
 */
export const getStoredUser = async (AsyncStorage) => {
  try {
    const userData = await AsyncStorage.getItem(USER_KEY);
    return userData ? JSON.parse(userData) : null;
  } catch (error) {
    console.error("Error getting stored user:", error);
    return null;
  }
};

/**
 * Clear all auth data (logout)
 */
export const clearAuthData = async (AsyncStorage) => {
  try {
    await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY, TOKEN_EXPIRY_KEY]);
  } catch (error) {
    console.error("Error clearing auth data:", error);
  }
};

/**
 * Check if token is expired or close to expiration
 */
export const isTokenExpiredOrClose = async (
  AsyncStorage,
  thresholdMinutes = 60
) => {
  try {
    const expiryStr = await AsyncStorage.getItem(TOKEN_EXPIRY_KEY);
    if (!expiryStr) return true;

    const expiry = parseInt(expiryStr);
    const now = Math.floor(Date.now() / 1000);
    const timeUntilExpiry = expiry - now;

    // Return true if expired or expires within threshold
    return timeUntilExpiry <= thresholdMinutes * 60;
  } catch (error) {
    console.error("Error checking token expiry:", error);
    return true;
  }
};

/**
 * Parse JWT payload (works with JWE tokens that have been decrypted)
 * Note: This is for client-side estimation only, server verification is required
 */
const parseJWTPayload = (token) => {
  try {
    // This won't work with JWE tokens directly, but can work with refreshed JWT tokens
    // For JWE tokens, rely on server-side expiry information
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const payload = JSON.parse(atob(parts[1]));
    return payload;
  } catch {
    // JWE tokens can't be parsed client-side, return null
    return null;
  }
};

/**
 * API request wrapper with automatic token handling
 */
export const apiRequest = async (
  url,
  options = {},
  AsyncStorage,
  navigation
) => {
  try {
    const token = await getStoredToken(AsyncStorage);

    if (!token) {
      handleLogout(AsyncStorage, navigation);
      throw new Error("No token available");
    }

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    // Check for token refresh headers
    const newToken = response.headers.get("X-New-Token");
    const tokenRefresh = response.headers.get("X-Token-Refresh");

    if (newToken && tokenRefresh === "true") {
      console.log("Token refreshed automatically");
      const user = await getStoredUser(AsyncStorage);
      await storeAuthData(newToken, user, AsyncStorage);
    }

    // Handle token expiration
    if (response.status === 401) {
      const errorData = await response.json();

      if (
        errorData.code === "TOKEN_EXPIRED" ||
        errorData.action === "REDIRECT_TO_LOGIN"
      ) {
        console.log("Token expired, logging out");
        handleLogout(AsyncStorage, navigation);
        throw new Error("Session expired");
      }
    }

    return response;
  } catch (error) {
    console.error("API request error:", error);
    throw error;
  }
};

/**
 * Handle automatic logout
 */
export const handleLogout = async (AsyncStorage, navigation) => {
  try {
    // Clear local storage
    await clearAuthData(AsyncStorage);

    // Navigate to login screen
    if (navigation) {
      navigation.reset({
        index: 0,
        routes: [{ name: "Login" }],
      });
    }

    // Show logout message (you can customize this)
    console.log("Logged out due to token expiration");
  } catch (error) {
    console.error("Error during logout:", error);
  }
};

/**
 * Validate token with server
 */
export const validateTokenWithServer = async (
  baseURL,
  AsyncStorage,
  navigation
) => {
  try {
    const response = await apiRequest(
      `${baseURL}/auth/validate-token`,
      { method: "GET" },
      AsyncStorage,
      navigation
    );

    if (response.ok) {
      const data = await response.json();
      return data.valid;
    }

    return false;
  } catch (error) {
    console.error("Token validation error:", error);
    return false;
  }
};

/**
 * Setup automatic token validation interval
 */
export const setupTokenValidation = (
  baseURL,
  AsyncStorage,
  navigation,
  intervalMinutes = 30
) => {
  const interval = setInterval(
    async () => {
      const isValid = await validateTokenWithServer(
        baseURL,
        AsyncStorage,
        navigation
      );

      if (!isValid) {
        console.log("Token validation failed, logging out");
        handleLogout(AsyncStorage, navigation);
        clearInterval(interval);
      }
    },
    intervalMinutes * 60 * 1000
  );

  return interval;
};

/**
 * React Native usage example:
 *
 * import AsyncStorage from '@react-native-async-storage/async-storage';
 * import { useNavigation } from '@react-navigation/native';
 * import {
 *   storeAuthData,
 *   apiRequest,
 *   setupTokenValidation,
 *   handleLogout
 * } from './utils/clientTokenHandler';
 *
 * // In your login component:
 * const handleLogin = async (email, password) => {
 *   try {
 *     const response = await fetch(`${API_BASE_URL}/users/signin`, {
 *       method: 'POST',
 *       headers: { 'Content-Type': 'application/json' },
 *       body: JSON.stringify({ email, password })
 *     });
 *
 *     const data = await response.json();
 *
 *     if (data.success) {
 *       await storeAuthData(data.token, data.user, AsyncStorage);
 *       // Navigate to main app
 *     }
 *   } catch (error) {
 *     console.error('Login error:', error);
 *   }
 * };
 *
 * // In your main app component:
 * useEffect(() => {
 *   const validationInterval = setupTokenValidation(
 *     API_BASE_URL,
 *     AsyncStorage,
 *     navigation,
 *     30 // Check every 30 minutes
 *   );
 *
 *   return () => clearInterval(validationInterval);
 * }, []);
 *
 * // For API calls:
 * const fetchUserData = async () => {
 *   try {
 *     const response = await apiRequest(
 *       `${API_BASE_URL}/users/profile`,
 *       { method: 'GET' },
 *       AsyncStorage,
 *       navigation
 *     );
 *
 *     const data = await response.json();
 *     // Handle data
 *   } catch (error) {
 *     // Handle error (token expiration is handled automatically)
 *   }
 * };
 */
