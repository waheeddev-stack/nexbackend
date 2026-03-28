import { useState, useEffect, useCallback } from "react";
import { apiService, apiUtils } from "../services/api";

// Custom hook for API calls with loading, error, and data state management
export const useApi = (apiCall, options = {}) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { immediate = true, onSuccess, onError, transform } = options;

  const execute = useCallback(
    async (...args) => {
      try {
        setLoading(true);
        setError(null);

        const response = await apiCall(...args);
        let responseData = response.data;

        // Transform data if transform function provided
        if (transform && typeof transform === "function") {
          responseData = transform(responseData);
        }

        setData(responseData);

        if (onSuccess) {
          onSuccess(responseData);
        }

        return responseData;
      } catch (err) {
        const errorMessage = apiUtils.handleError(err);
        setError(errorMessage);

        if (onError) {
          onError(errorMessage, err);
        }

        throw err;
      } finally {
        setLoading(false);
      }
    },
    [apiCall, transform, onSuccess, onError]
  );

  useEffect(() => {
    if (immediate) {
      execute();
    }
  }, [execute, immediate]);

  return {
    data,
    loading,
    error,
    execute,
    refetch: execute,
  };
};

// Hook for products
export const useProducts = (params = {}) => {
  return useApi(
    () => apiService.products.getAll(params),
    [JSON.stringify(params)],
    {
      transform: (data) => data.products || data,
    }
  );
};

// Hook for shopkeeper products
export const useShopkeeperProducts = (shopkeeperId, params = {}) => {
  return useApi(
    () => apiService.products.getByShopkeeper(shopkeeperId, params),
    [shopkeeperId, JSON.stringify(params)],
    {
      immediate: !!shopkeeperId,
      transform: (data) => data.products || data,
    }
  );
};

// Hook for user orders
export const useUserOrders = (userId, params = {}) => {
  return useApi(
    () => apiService.orders.getUserOrders(userId, params),
    [userId, JSON.stringify(params)],
    {
      immediate: !!userId,
      transform: (data) => data.orders || data,
    }
  );
};

// Hook for user profile
export const useUserProfile = (userId) => {
  return useApi(() => apiService.users.getProfile(userId), [userId], {
    immediate: !!userId,
    transform: (data) => data.user || data,
  });
};

// Hook for admin dashboard
export const useAdminDashboard = () => {
  return useApi(() => apiService.admin.getDashboard(), [], {
    transform: (data) => data.dashboard || data,
  });
};

// Hook for shopkeepers list (admin)
export const useShopkeepers = (params = {}) => {
  return useApi(
    () => apiService.admin.getShopkeepers(params),
    [JSON.stringify(params)],
    {
      transform: (data) => data.shopkeepers || data,
    }
  );
};

// Hook for API connection status
export const useApiConnection = () => {
  const [isConnected, setIsConnected] = useState(true);
  const [checking, setChecking] = useState(false);

  const checkConnection = useCallback(async () => {
    setChecking(true);
    try {
      const connected = await apiUtils.checkConnection();
      setIsConnected(connected);
    } catch (e) {
      setIsConnected(false);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    checkConnection();

    // Check connection every 30 seconds
    const interval = setInterval(checkConnection, 30000);

    return () => clearInterval(interval);
  }, [checkConnection]);

  return {
    isConnected,
    checking,
    checkConnection,
  };
};

// Hook for authentication
export const useAuth = () => {
  const [user, setUser] = useState(null);
  const [userType, setUserType] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Check for existing auth token on mount
    const token = localStorage.getItem("authToken");
    const type = localStorage.getItem("userType");

    if (token && type) {
      setUserType(type);
      // You might want to validate the token here
    }
  }, []);

  const login = useCallback(async (credentials, type = "user") => {
    setLoading(true);
    try {
      let response;

      switch (type) {
        case "admin":
          response = await apiService.auth.adminLogin(credentials);
          break;
        case "shopkeeper":
          response = await apiService.auth.shopkeeperSignin(credentials);
          break;
        default:
          response = await apiService.auth.userSignin(credentials);
      }

      const { token, user: userData } = response.data;

      apiUtils.setAuthToken(token);
      localStorage.setItem("userType", type);

      setUser(userData);
      setUserType(type);

      return { success: true, user: userData };
    } catch (error) {
      const errorMessage = apiUtils.handleError(error);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    apiUtils.clearAuthToken();
    setUser(null);
    setUserType(null);
  }, []);

  const signup = useCallback(async (userData, type = "user") => {
    setLoading(true);
    try {
      let response;

      switch (type) {
        case "shopkeeper":
          response = await apiService.auth.shopkeeperSignup(userData);
          break;
        default:
          response = await apiService.auth.userSignup(userData);
      }

      return { success: true, data: response.data };
    } catch (error) {
      const errorMessage = apiUtils.handleError(error);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    user,
    userType,
    loading,
    login,
    logout,
    signup,
    isAuthenticated: !!user || !!localStorage.getItem("authToken"),
  };
};

export default useApi;
