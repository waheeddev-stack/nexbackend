import dotenv from 'dotenv';

dotenv.config();

// Environment validation
const requiredEnvVars = [
  'JWT_SECRET',
  'DB_HOST',
  'DB_USER',
  'DB_PASS',
  'DB_NAME'
];

const optionalEnvVars = {
  NODE_ENV: 'development',
  PORT: '5000',
  DB_PORT: '3306',
  DB_SSL: 'false',
  CLOUDINARY_CLOUD_NAME: '',
  CLOUDINARY_API_KEY: '',
  CLOUDINARY_API_SECRET: '',
  ADMIN_EMAIL: '',
  ADMIN_PASSWORD: ''
};

// Validate required environment variables
export const validateEnvironment = () => {
  const missing = requiredEnvVars.filter(envVar => !process.env[envVar]);
  
  if (missing.length > 0) {
    if (process.env.ALLOW_PARTIAL_ENV === 'true' || process.env.RENDER === 'true') {
      console.warn(`⚠️ Partial environment detected. Missing: ${missing.join(', ')}. Continuing boot for deployment environment.`);
    } else {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
  }

  // Validate JWT_SECRET strength
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    if (process.env.ALLOW_PARTIAL_ENV === 'true' || process.env.RENDER === 'true') {
      console.warn('⚠️ Weak JWT_SECRET detected. Proceeding for deployment environment. Set a strong secret ASAP.');
    } else {
      throw new Error('JWT_SECRET must be at least 32 characters for security');
    }
  }

  // Validate database configuration
  if (!process.env.DB_HOST || !process.env.DB_NAME) {
    if (process.env.ALLOW_PARTIAL_ENV === 'true' || process.env.RENDER === 'true') {
      console.warn('⚠️ Database configuration incomplete. Booting without DB for deployment environment.');
    } else {
      throw new Error('Database configuration is incomplete');
    }
  }

  return true;
};

// Get environment configuration
export const getConfig = () => {
  validateEnvironment();

  return {
    // Environment
    NODE_ENV: process.env.NODE_ENV || optionalEnvVars.NODE_ENV,
    PORT: parseInt(process.env.PORT) || parseInt(optionalEnvVars.PORT),
    
    // Security
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
    
    // Database
    database: {
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT) || parseInt(optionalEnvVars.DB_PORT),
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      ssl: process.env.DB_SSL === 'true',
      sslCA: process.env.DB_SSL_CA
    },
    
    // Cloudinary
    cloudinary: {
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET
    },
    
    // Admin
    admin: {
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD
    },
    
    // CORS origins based on environment
    corsOrigins: process.env.NODE_ENV === 'production' 
      ? [
          "https://nexadminpanel.vercel.app",
          "https://nexkirana-admin.vercel.app", 
          "https://nexkirana.vercel.app"
        ]
      : true,
    
    // API URLs for different environments
    apiUrls: {
      development: 'http://localhost:5000',
      production: 'https://nexbackend.onrender.com',
      staging: process.env.STAGING_URL || 'https://staging-nexbackend.onrender.com'
    }
  };
};

// Get API URL for current environment
export const getApiUrl = () => {
  const config = getConfig();
  return config.apiUrls[config.NODE_ENV] || config.apiUrls.development;
};

export default getConfig();
