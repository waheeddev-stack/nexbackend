/**
 * Order Placement Caching Service
 * 
 * Implements in-memory caching for frequently accessed data during order placement.
 * Reduces database queries and improves response time.
 * 
 * Performance Impact: ~50-100ms reduction
 * 
 * Cache Strategy:
 * - Shopkeeper status: 5-10 minute TTL
 * - Product details: 15-30 minute TTL
 * - User points: 1-2 minute TTL
 */

// Simple in-memory cache (can be replaced with Redis for production)
class OrderCache {
  constructor() {
    this.cache = new Map();
    this.timers = new Map();
  }

  /**
   * Set cache value with TTL
   */
  set(key, value, ttlSeconds = 300) {
    // Clear existing timer
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
    }

    // Set value
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      ttl: ttlSeconds,
    });

    // Set expiration timer
    const timer = setTimeout(() => {
      this.cache.delete(key);
      this.timers.delete(key);
    }, ttlSeconds * 1000);

    this.timers.set(key, timer);
  }

  /**
   * Get cache value if not expired
   */
  get(key) {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    const age = (Date.now() - entry.timestamp) / 1000;
    if (age > entry.ttl) {
      this.cache.delete(key);
      this.timers.delete(key);
      return null;
    }

    return entry.value;
  }

  /**
   * Check if key exists and is valid
   */
  has(key) {
    return this.get(key) !== null;
  }

  /**
   * Delete cache entry
   */
  delete(key) {
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }
    this.cache.delete(key);
  }

  /**
   * Clear all cache
   */
  clear() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.cache.clear();
    this.timers.clear();
  }

  /**
   * Get cache stats
   */
  getStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

// Global cache instance
const orderCache = new OrderCache();

// ============================================================================
// SHOPKEEPER CACHE
// ============================================================================

/**
 * Get shopkeeper status from cache or database
 * TTL: 5-10 minutes (shopkeeper status doesn't change frequently)
 */
export async function getCachedShopkeeperStatus(shopkeeperId, connection) {
  const cacheKey = `shop_status_${shopkeeperId}`;

  // Check cache first
  const cached = orderCache.get(cacheKey);
  if (cached) {
    console.log(`✅ Cache hit: Shopkeeper status for ${shopkeeperId}`);
    return cached;
  }

  // Fetch from database
  const [shopkeeperCheck] = await connection.execute(
    `SELECT id, subscription_status, is_deleted FROM shopkeepers WHERE id = ? LIMIT 1`,
    [shopkeeperId]
  );

  if (!shopkeeperCheck || shopkeeperCheck.length === 0) {
    throw {
      status: 404,
      code: "SHOP_NOT_FOUND",
      message: "Shopkeeper not found",
    };
  }

  const shopkeeper = shopkeeperCheck[0];

  if (shopkeeper.is_deleted) {
    throw {
      status: 400,
      code: "SHOP_DELETED",
      message: "This shop is no longer available",
    };
  }

  if (shopkeeper.subscription_status !== "active") {
    throw {
      status: 400,
      code: "SHOP_INACTIVE",
      message: `Shop is currently ${shopkeeper.subscription_status}`,
      shopStatus: shopkeeper.subscription_status,
    };
  }

  // Cache for 5 minutes
  orderCache.set(cacheKey, shopkeeper, 300);
  console.log(`📝 Cached: Shopkeeper status for ${shopkeeperId}`);

  return shopkeeper;
}

/**
 * Invalidate shopkeeper cache when status changes
 */
export function invalidateShopkeeperCache(shopkeeperId) {
  const cacheKey = `shop_status_${shopkeeperId}`;
  orderCache.delete(cacheKey);
  console.log(`🗑️ Invalidated: Shopkeeper cache for ${shopkeeperId}`);
}

// ============================================================================
// PRODUCT CACHE
// ============================================================================

/**
 * Get product details from cache or database
 * TTL: 15-30 minutes (product details change less frequently)
 */
export async function getCachedProductDetails(productIds, connection) {
  if (!productIds || productIds.length === 0) {
    return [];
  }

  const cached = [];
  const uncached = [];

  // Check cache for each product
  for (const productId of productIds) {
    const cacheKey = `product_${productId}`;
    const cachedProduct = orderCache.get(cacheKey);

    if (cachedProduct) {
      cached.push(cachedProduct);
    } else {
      uncached.push(productId);
    }
  }

  // Fetch uncached products from database
  if (uncached.length > 0) {
    const placeholders = uncached.map(() => "?").join(",");
    const [products] = await connection.execute(
      `SELECT id, name, image, category, price, mrp FROM products WHERE id IN (${placeholders})`,
      uncached
    );

    // Cache each product for 20 minutes
    for (const product of products) {
      const cacheKey = `product_${product.id}`;
      orderCache.set(cacheKey, product, 1200);
    }

    cached.push(...products);
    console.log(
      `📝 Cached: ${products.length} products, ${cached.length - products.length} from cache`
    );
  } else {
    console.log(`✅ Cache hit: All ${productIds.length} products`);
  }

  return cached;
}

/**
 * Invalidate product cache when stock changes
 */
export function invalidateProductCache(productId) {
  const cacheKey = `product_${productId}`;
  orderCache.delete(cacheKey);
  console.log(`🗑️ Invalidated: Product cache for ${productId}`);
}

/**
 * Invalidate multiple products
 */
export function invalidateProductsCache(productIds) {
  for (const productId of productIds) {
    invalidateProductCache(productId);
  }
}

// ============================================================================
// USER POINTS CACHE
// ============================================================================

/**
 * Get user points from cache or database
 * TTL: 1-2 minutes (points change frequently during orders)
 */
export async function getCachedUserPoints(userId, connection) {
  const cacheKey = `user_points_${userId}`;

  // Check cache first
  const cached = orderCache.get(cacheKey);
  if (cached) {
    console.log(`✅ Cache hit: User points for ${userId}`);
    return cached;
  }

  // Fetch from database
  const [[user]] = await connection.execute(
    "SELECT store_credits FROM users WHERE id = ?",
    [userId]
  );

  if (!user) {
    throw {
      status: 404,
      message: "User not found",
    };
  }

  const points = user.store_credits || 0;

  // Cache for 1 minute
  orderCache.set(cacheKey, { store_credits: points }, 60);
  console.log(`📝 Cached: User points for ${userId}`);

  return { store_credits: points };
}

/**
 * Invalidate user points cache when points change
 */
export function invalidateUserPointsCache(userId) {
  const cacheKey = `user_points_${userId}`;
  orderCache.delete(cacheKey);
  console.log(`🗑️ Invalidated: User points cache for ${userId}`);
}

// ============================================================================
// BATCH CACHE OPERATIONS
// ============================================================================

/**
 * Get multiple users' points from cache
 */
export async function getCachedMultipleUserPoints(userIds, connection) {
  const results = {};
  const uncachedIds = [];

  for (const userId of userIds) {
    const cacheKey = `user_points_${userId}`;
    const cached = orderCache.get(cacheKey);

    if (cached) {
      results[userId] = cached;
    } else {
      uncachedIds.push(userId);
    }
  }

  // Fetch uncached users
  if (uncachedIds.length > 0) {
    const placeholders = uncachedIds.map(() => "?").join(",");
    const [users] = await connection.execute(
      `SELECT id, store_credits FROM users WHERE id IN (${placeholders})`,
      uncachedIds
    );

    for (const user of users) {
      const points = user.store_credits || 0;
      results[user.id] = { store_credits: points };

      // Cache for 1 minute
      const cacheKey = `user_points_${user.id}`;
      orderCache.set(cacheKey, { store_credits: points }, 60);
    }
  }

  return results;
}

// ============================================================================
// CACHE MANAGEMENT
// ============================================================================

/**
 * Get cache statistics
 */
export function getCacheStats() {
  return orderCache.getStats();
}

/**
 * Clear all cache
 */
export function clearAllCache() {
  orderCache.clear();
  console.log("🗑️ Cleared all cache");
}

/**
 * Clear specific cache type
 */
export function clearCacheByPattern(pattern) {
  const stats = orderCache.getStats();
  let cleared = 0;

  for (const key of stats.keys) {
    if (key.includes(pattern)) {
      orderCache.delete(key);
      cleared++;
    }
  }

  console.log(`🗑️ Cleared ${cleared} cache entries matching pattern: ${pattern}`);
  return cleared;
}

/**
 * Export cache instance for advanced usage
 */
export { orderCache };

