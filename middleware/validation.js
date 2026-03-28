import validator from "validator";

// Sanitize string input
export const sanitizeString = (str) => {
  if (typeof str !== "string") return str;

  return str
    .trim()
    .replace(/[<>]/g, "") // Remove potential HTML tags
    .substring(0, 1000); // Limit length
};

// Validate email format
export const validateEmail = (email) => {
  if (!email || typeof email !== "string") {
    throw new Error("Email is required and must be a string");
  }

  if (!validator.isEmail(email)) {
    throw new Error("Invalid email format");
  }

  if (email.length > 254) {
    throw new Error("Email too long");
  }

  return email.toLowerCase().trim();
};

// Validate password strength
export const validatePassword = (password) => {
  if (!password || typeof password !== "string") {
    throw new Error("Password is required");
  }

  if (password.length < 6) {
    throw new Error("Password must be at least 6 characters long");
  }

  if (password.length > 128) {
    throw new Error("Password too long");
  }

  return password;
};

// Validate phone number
export const validatePhone = (phone) => {
  if (!phone) return null;

  if (typeof phone !== "string") {
    throw new Error("Phone must be a string");
  }

  const cleanPhone = phone.replace(/\D/g, "");

  if (cleanPhone.length !== 10) {
    throw new Error("Phone number must be 10 digits");
  }

  return cleanPhone;
};

// Validate numeric input
export const validateNumber = (
  value,
  fieldName,
  min = 0,
  max = Number.MAX_SAFE_INTEGER
) => {
  const num = Number(value);

  if (isNaN(num)) {
    throw new Error(`${fieldName} must be a valid number`);
  }

  if (num < min || num > max) {
    throw new Error(`${fieldName} must be between ${min} and ${max}`);
  }

  return num;
};

// Validate required fields
export const validateRequired = (obj, requiredFields) => {
  const missing = requiredFields.filter((field) => {
    const value = obj[field];
    return value === undefined || value === null || value === "";
  });

  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(", ")}`);
  }
};

// Validate order data
export const validateOrderData = (orderData) => {
  const { products, total, address } = orderData;

  validateRequired(orderData, ["products", "total", "address"]);

  if (!Array.isArray(products) || products.length === 0) {
    throw new Error("Products must be a non-empty array");
  }

  const validatedTotal = validateNumber(total, "total", 0.01, 100000);

  if (typeof address !== "string" || address.trim().length < 10) {
    throw new Error("Address must be at least 10 characters long");
  }

  // Validate each product
  products.forEach((product, index) => {
    validateRequired(product, ["product_id", "quantity", "price"]);

    validateNumber(product.product_id, `products[${index}].product_id`, 1);
    validateNumber(product.quantity, `products[${index}].quantity`, 1, 100);
    validateNumber(product.price, `products[${index}].price`, 0.01, 10000);
  });

  return {
    products,
    total: validatedTotal,
    address: sanitizeString(address),
  };
};

// Validate product data
export const validateProductData = (productData) => {
  const { name, price, stock } = productData;

  validateRequired(productData, ["name", "price", "stock"]);

  const validatedName = sanitizeString(name);
  if (validatedName.length < 2 || validatedName.length > 100) {
    throw new Error("Product name must be between 2 and 100 characters");
  }

  const validatedPrice = validateNumber(price, "price", 0.01, 100000);
  const validatedStock = validateNumber(stock, "stock", 0, 10000);

  return {
    ...productData,
    name: validatedName,
    price: validatedPrice,
    stock: validatedStock,
    description: productData.description
      ? sanitizeString(productData.description)
      : null,
    category: productData.category
      ? sanitizeString(productData.category)
      : null,
  };
};

// Validate user registration data
export const validateUserRegistration = (userData) => {
  const { name, email, password } = userData;

  validateRequired(userData, ["name", "email", "password"]);

  const validatedName = sanitizeString(name);
  if (validatedName.length < 2 || validatedName.length > 50) {
    throw new Error("Name must be between 2 and 50 characters");
  }

  const validatedEmail = validateEmail(email);
  const validatedPassword = validatePassword(password);

  return {
    name: validatedName,
    email: validatedEmail,
    password: validatedPassword,
    phone: userData.phone ? validatePhone(userData.phone) : null,
  };
};

// Validate shopkeeper registration data
export const validateShopkeeperRegistration = (shopkeeperData) => {
  const { name, email, password, phone, shop_name } = shopkeeperData;

  validateRequired(shopkeeperData, [
    "name",
    "email",
    "password",
    "phone",
    "shop_name",
  ]);

  const validatedName = sanitizeString(name);
  if (validatedName.length < 2 || validatedName.length > 50) {
    throw new Error("Name must be between 2 and 50 characters");
  }

  const validatedShopName = sanitizeString(shop_name);
  if (validatedShopName.length < 2 || validatedShopName.length > 100) {
    throw new Error("Shop name must be between 2 and 100 characters");
  }

  const validatedEmail = validateEmail(email);
  const validatedPassword = validatePassword(password);
  const validatedPhone = validatePhone(phone);

  return {
    name: validatedName,
    email: validatedEmail,
    password: validatedPassword,
    phone: validatedPhone,
    shop_name: validatedShopName,
  };
};

// Middleware factory for validation
export const validate = (validationFn) => {
  return (req, res, next) => {
    try {
      req.validatedData = validationFn(req.body);
      next();
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
        code: "VALIDATION_ERROR",
      });
    }
  };
};

// Rate limiting helper
export const createRateLimiter = (windowMs = 15 * 60 * 1000, max = 100) => {
  const requests = new Map();

  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean old entries
    for (const [key, timestamp] of requests.entries()) {
      if (timestamp < windowStart) {
        requests.delete(key);
      }
    }

    // Count requests from this IP in current window
    const ipRequests = Array.from(requests.entries()).filter(
      ([key, timestamp]) => key.startsWith(ip) && timestamp >= windowStart
    ).length;

    if (ipRequests >= max) {
      return res.status(429).json({
        success: false,
        message: "Too many requests, please try again later",
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    // Record this request
    requests.set(`${ip}-${now}`, now);

    next();
  };
};
