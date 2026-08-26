// Minimal rate limiter factory
const ipRequestCounts = new Map();

export function createRateLimiter(windowMs, max) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();

    if (!ipRequestCounts.has(ip)) {
      ipRequestCounts.set(ip, { count: 1, resetTime: now + windowMs });
    } else {
      const record = ipRequestCounts.get(ip);
      if (now > record.resetTime) {
        record.count = 1;
        record.resetTime = now + windowMs;
      } else {
        record.count++;
      }

      if (record.count > max) {
        return res.status(429).json({
          success: false,
          message: "Too many requests, please try again later.",
        });
      }
    }
    next();
  };
}

export const trackingRateLimiter = createRateLimiter(60 * 1000, 30); // 30 requests per minute for tracking endpoints

export const validateUserRegistration = {};

export function validateEmail(email) {
  if (typeof email !== "string") {
    throw new Error("Email must be a string");
  }
  const trimmed = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmed)) {
    throw new Error("Invalid email format");
  }
  return trimmed;
}

export function validatePassword(password) {
  if (typeof password !== "string") {
    throw new Error("Password must be a string");
  }
  if (password.length < 6) {
    throw new Error("Password must be at least 6 characters long");
  }
  return password;
}
export const validate = () => (req, res, next) => {
  req.validatedData = req.body;
  next();
};
