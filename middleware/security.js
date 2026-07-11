import helmet from "helmet";

const securityMiddleware = {
  securityHeaders: [helmet()],
  requestSizeLimiter: (req, res, next) => {
    // Keep simple: rely on express.json limit; do not hard-block uploads.
    next();
  },
  corsConfig: {
    origin: true,
    credentials: true,
    methods: ["GET", "POST"],
    allowedHeaders: ["*"],
  },
  sanitizeRequest: (req, res, next) => next(),
  requestLogger: (req, res, next) => next(),
  notFoundHandler: (req, res) => {
    res.status(404).json({ success: false, message: "Not found" });
  },
  errorHandler: (err, req, res, next) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  },
};

export default securityMiddleware;

