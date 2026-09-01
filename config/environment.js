import dotenv from "dotenv";

dotenv.config();

// Environment validation
// Supports both Neon Postgres (DATABASE_URL or PGHOST etc.) and legacy DB_* (TiDB)
// DATABASE_URL is preferred for Neon; if present, DB_HOST checks are relaxed.
const requiredEnvVars = ["JWT_SECRET"];

const optionalEnvVars = {
  NODE_ENV: "development",
  PORT: "5000",
  DB_PORT: "5432",
  DB_SSL: "true",
  // Legacy Cloudinary (deprecated) — ImageKit is preferred
  CLOUDINARY_CLOUD_NAME: "",
  CLOUDINARY_API_KEY: "",
  CLOUDINARY_API_SECRET: "",
  // ImageKit (Neon-era image service)
  IMAGEKIT_PUBLIC_KEY: "",
  IMAGEKIT_PRIVATE_KEY: "",
  IMAGEKIT_URL_ENDPOINT: "",
  // Neon / Postgres individual vars
  PGHOST: "",
  PGUSER: "",
  PGPASSWORD: "",
  PGDATABASE: "",
  PGPORT: "5432",
  DATABASE_URL: "",
  NEON_DATABASE_URL: "",
  ADMIN_EMAIL: "",
  ADMIN_PASSWORD: "",
};

// Validate required environment variables
export const validateEnvironment = () => {
  const missing = requiredEnvVars.filter((envVar) => !process.env[envVar]);

  if (missing.length > 0) {
    if (
      process.env.ALLOW_PARTIAL_ENV === "true" ||
      process.env.RENDER === "true"
    ) {
      console.warn(
        `⚠️ Partial environment detected. Missing: ${missing.join(", ")}. Continuing boot for deployment environment.`
      );
    } else {
      throw new Error(
        `Missing required environment variables: ${missing.join(", ")}`
      );
    }
  }

  // Validate JWT_SECRET strength
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    if (
      process.env.ALLOW_PARTIAL_ENV === "true" ||
      process.env.RENDER === "true"
    ) {
      console.warn(
        "⚠️ Weak JWT_SECRET detected. Proceeding for deployment environment. Set a strong secret ASAP."
      );
    } else {
      throw new Error("JWT_SECRET must be at least 32 characters for security");
    }
  }

  // Validate database configuration (Neon Postgres)
  const hasNeonUrl =
    !!process.env.DATABASE_URL ||
    !!process.env.NEON_DATABASE_URL ||
    !!process.env.POSTGRES_URL;
  const hasPgHost = !!process.env.PGHOST;
  const hasLegacyDb = !!process.env.DB_HOST && !!process.env.DB_NAME;
  if (!hasNeonUrl && !hasPgHost && !hasLegacyDb) {
    if (
      process.env.ALLOW_PARTIAL_ENV === "true" ||
      process.env.RENDER === "true"
    ) {
      console.warn(
        "⚠️ Database configuration incomplete (set DATABASE_URL or PGHOST/DB_HOST). Booting without DB for deployment environment."
      );
    } else {
      throw new Error(
        "Database configuration is incomplete — set DATABASE_URL (Neon) or DB_HOST/DB_NAME"
      );
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
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "7d",

    // Database (Neon Postgres primary; legacy DB_* kept for fallback)
    database: {
      // Neon URL takes precedence
      connectionString:
        process.env.DATABASE_URL ||
        process.env.NEON_DATABASE_URL ||
        process.env.POSTGRES_URL ||
        null,
      host: process.env.PGHOST || process.env.DB_HOST,
      port: parseInt(
        process.env.PGPORT || process.env.DB_PORT || optionalEnvVars.DB_PORT,
        10
      ),
      user: process.env.PGUSER || process.env.DB_USER,
      password: process.env.PGPASSWORD || process.env.DB_PASS,
      database: process.env.PGDATABASE || process.env.DB_NAME,
      ssl: process.env.PGSSLMODE === "require" || process.env.DB_SSL === "true" || true,
      sslCA: process.env.DB_SSL_CA,
    },

    // ImageKit (primary) + Cloudinary (deprecated shim)
    imagekit: {
      publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
      privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
      urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
    },
    cloudinary: {
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    },

    // Admin
    admin: {
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    },

    // CORS origins based on environment
    corsOrigins:
      process.env.NODE_ENV === "production"
        ? [
            "https://nexadminpanel.vercel.app",
            "https://nexkirana-admin.vercel.app",
            "https://nexkirana.vercel.app",
          ]
        : true,

    // API URLs for different environments
    apiUrls: {
      development: "http://localhost:5000",
      production: "https://nexbackend.onrender.com",
      staging:
        process.env.STAGING_URL || "https://staging-nexbackend.onrender.com",
    },
  };
};

// Get API URL for current environment
export const getApiUrl = () => {
  const config = getConfig();
  return config.apiUrls[config.NODE_ENV] || config.apiUrls.development;
};

export default getConfig();
