// API Service Configuration for NexKirana
import axios from 'axios';

// Get API base URL from environment variables
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api';
const ENVIRONMENT = process.env.REACT_APP_ENVIRONMENT || 'development';
const DEBUG_MODE = process.env.REACT_APP_DEBUG_MODE === 'true';

// Create axios instance with default configuration
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000, // 30 seconds timeout
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for adding auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('authToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    
    if (DEBUG_MODE) {
      console.log('🚀 API Request:', {
        method: config.method?.toUpperCase(),
        url: config.url,
        baseURL: config.baseURL,
        data: config.data,
      });
    }
    
    return config;
  },
  (error) => {
    if (DEBUG_MODE) {
      console.error('❌ Request Error:', error);
    }
    return Promise.reject(error);
  }
);

// Response interceptor for handling errors
api.interceptors.response.use(
  (response) => {
    if (DEBUG_MODE) {
      console.log('✅ API Response:', {
        status: response.status,
        url: response.config.url,
        data: response.data,
      });
    }
    return response;
  },
  (error) => {
    if (DEBUG_MODE) {
      console.error('❌ API Error:', {
        status: error.response?.status,
        url: error.config?.url,
        message: error.message,
        data: error.response?.data,
      });
    }

    // Handle specific error cases
    if (error.response?.status === 401) {
      // Unauthorized - clear token and redirect to login
      localStorage.removeItem('authToken');
      localStorage.removeItem('userType');
      if (ENVIRONMENT === 'production') {
        window.location.href = '/login';
      }
    }

    // Network error handling
    if (!error.response) {
      const networkError = new Error('Network error - please check your connection');
      networkError.isNetworkError = true;
      return Promise.reject(networkError);
    }

    return Promise.reject(error);
  }
);

// API Service Methods
export const apiService = {
  // Health Check
  healthCheck: () => api.get('/health'),
  
  // Authentication
  auth: {
    adminLogin: (credentials) => api.post('/admin/login', credentials),
    userSignin: (credentials) => api.post('/user/signin', credentials),
    userSignup: (userData) => api.post('/user/signup', userData),
    shopkeeperSignin: (credentials) => api.post('/shopkeeper/signin', credentials),
    shopkeeperSignup: (shopkeeperData) => api.post('/shopkeeper/signup', shopkeeperData),
  },

  // Products
  products: {
    getAll: (params = {}) => {
      const userType = localStorage.getItem('userType');
      const prefix = userType === 'admin' ? '/admin' : '/shopkeeper';
      return api.get(`${prefix}/products`, { params });
    },
    getById: (productId) => {
      const userType = localStorage.getItem('userType');
      const prefix = userType === 'admin' ? '/admin' : '/shopkeeper';
      return api.get(`${prefix}/products/${productId}`);
    },
    create: (productData) => {
      const config = productData instanceof FormData ? {
        headers: { 'Content-Type': 'multipart/form-data' }
      } : {};
      return api.post('/shopkeeper/products', productData, config);
    },
    update: (productId, productData) => {
      const config = productData instanceof FormData ? {
        headers: { 'Content-Type': 'multipart/form-data' }
      } : {};
      return api.put(`/shopkeeper/products/${productId}`, productData, config);
    },
    delete: (productId) => api.delete(`/shopkeeper/products/${productId}`),
    updateStock: (productId, stock) => api.patch(`/shopkeeper/products/${productId}/stock`, { stock }),
    addFromGlobal: (data) => api.post('/shopkeeper/products/from-global', data)
  },

  // Orders
  orders: {
    getAll: (params = {}) => api.get('/orders', { params }),
    getById: (orderId) => api.get(`/orders/${orderId}`),
    create: (orderData) => api.post('/orders', orderData),
    updateStatus: (orderId, status, reason) => 
      api.patch(`/orders/${orderId}/status`, { status, cancellation_reason: reason }),
    cancel: (orderId, reason) => 
      api.post(`/orders/${orderId}/cancel`, { cancellation_reason: reason }),
    getStats: (shopkeeperId) => api.get('/shopkeeper/stats') // Stats are still in shopkeeperRoute
  },

  // Users
  users: {
    getProfile: (userId) => api.get(`/user/profile/${userId}`),
    updateProfile: (userId, userData) => api.patch(`/user/profile/${userId}`, userData),
  },

  // Shopkeepers
  shopkeepers: {
    getProfile: (shopkeeperId) => api.get(`/shopkeeper/profile/${shopkeeperId}`),
    updateProfile: (shopkeeperId, shopkeeperData) => 
      api.patch(`/shopkeeper/profile/${shopkeeperId}`, shopkeeperData),
    getAll: (params = {}) => api.get('/shopkeepers', { params }),
  },

  // Admin
  admin: {
    getDashboard: () => api.get('/admin/dashboard'),
    getShopkeepers: (params = {}) => api.get('/admin/shopkeepers', { params }),
    verifyShopkeeper: (shopkeeperId, action) => 
      api.patch(`/admin/shopkeepers/${shopkeeperId}/verify`, { action }),
    getUsers: (params = {}) => api.get('/admin/users', { params }),
    getOrders: (params = {}) => api.get('/admin/orders', { params }),
  },
};

// Utility functions
export const apiUtils = {
  // Set auth token
  setAuthToken: (token) => {
    localStorage.setItem('authToken', token);
  },

  // Clear auth token
  clearAuthToken: () => {
    localStorage.removeItem('authToken');
    localStorage.removeItem('userType');
  },

  // Get current API base URL
  getBaseURL: () => API_BASE_URL,

  // Check if API is reachable
  checkConnection: async () => {
    try {
      await api.get('/health');
      return true;
    } catch (error) {
      return false;
    }
  },

  // Handle API errors
  handleError: (error) => {
    if (error.isNetworkError) {
      return 'Network connection error. Please check your internet connection.';
    }
    
    if (error.response?.data?.message) {
      return error.response.data.message;
    }
    
    if (error.response?.status === 500) {
      return 'Server error. Please try again later.';
    }
    
    return error.message || 'An unexpected error occurred.';
  },
};

export default api;