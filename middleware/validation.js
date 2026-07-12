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
          message: "Too many requests, please try again later."
        });
      }
    }
    next();
  };
}

export const trackingRateLimiter = createRateLimiter(60 * 1000, 30); // 30 requests per minute for tracking endpoints

export const validateUserRegistration = {};
export const validateEmail = {};
export const validatePassword = {};
export const validate = (schema) => (req, res, next) => {
  req.validatedData = req.body;
  next();
};
