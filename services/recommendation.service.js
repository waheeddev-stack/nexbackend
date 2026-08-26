import pool from "../config/db.js";

function normalizeText(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

function tokenize(text) {
  return normalizeText(text).split(" ");
}

function calculateJaccard(a, b) {
  if (!a.length && !b.length) return 0;
  const intersection = new Set(a.filter((value) => b.includes(value)));
  const union = new Set([...a, ...b]);
  return intersection.size / union.size;
}

function scoreRecommendationCandidates({
  userProductIds = [],
  catalog = [],
  coPurchaseMap = new Map(),
  categoryAffinity = new Map(),
  popularityMap = new Map(),
  topN = 5,
}) {
  const seen = new Set(userProductIds);
  const scored = [];

  for (const product of catalog) {
    if (seen.has(product.id)) continue;

    const coPurchaseScore = coPurchaseMap.get(product.id) || 0;
    const categoryScore = categoryAffinity.get(product.category) || 0;
    const popularityScore = popularityMap.get(product.id) || 0;
    const score =
      coPurchaseScore * 2.8 + categoryScore * 1.6 + popularityScore * 0.1;

    if (score > 0 || product.category) {
      scored.push({
        product_id: product.id,
        score,
        reason: `behavioral+category:${product.category}`,
        product,
      });
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, topN);
}

function getBehavioralRecommendations({
  userProductIds = [],
  catalog = [],
  allOrders = [],
  topN = 5,
}) {
  const productMap = new Map(catalog.map((product) => [product.id, product]));
  const purchaseCounts = new Map();
  const pairCounts = new Map();

  for (const order of allOrders) {
    const orderedProducts = (order.items || [])
      .map((item) => item.product_id)
      .filter((productId) => productMap.has(productId));

    for (const productId of orderedProducts) {
      purchaseCounts.set(productId, (purchaseCounts.get(productId) || 0) + 1);
    }

    for (let i = 0; i < orderedProducts.length; i += 1) {
      for (let j = i + 1; j < orderedProducts.length; j += 1) {
        const left = orderedProducts[i];
        const right = orderedProducts[j];
        if (left === right) continue;
        const key = [left, right].sort((a, b) => a - b).join(":");
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }
    }
  }

  const scores = [];
  const seen = new Set(userProductIds);

  for (const [key, count] of pairCounts.entries()) {
    const [left, right] = key.split(":").map(Number);
    const relevant = userProductIds.includes(left)
      ? right
      : userProductIds.includes(right)
        ? left
        : null;

    if (!relevant || seen.has(relevant)) continue;

    const support = count / Math.max(1, allOrders.length);
    const popularity = purchaseCounts.get(relevant) || 0;
    const score = support * 3 + popularity * 0.2;
    scores.push({ product_id: relevant, score, reason: "behavioral" });
  }

  const ranked = scores
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map((item) => ({
      ...item,
      product: productMap.get(item.product_id) || null,
    }));

  if (ranked.length < topN) {
    const fallbackItems = catalog
      .filter((product) => !seen.has(product.id))
      .sort((a, b) => (a.id > b.id ? 1 : -1))
      .slice(0, topN - ranked.length)
      .map((product) => ({
        product_id: product.id,
        score: 0,
        reason: "fallback",
        product,
      }));
    ranked.push(...fallbackItems);
  }

  return ranked;
}

function getContentRecommendations({
  userProducts = [],
  catalog = [],
  topN = 5,
}) {
  const userTokens = userProducts.flatMap((product) =>
    tokenize(`${product.name} ${product.category} ${product.description}`)
  );
  const scored = [];

  for (const product of catalog) {
    if (userProducts.some((item) => item.id === product.id)) continue;
    const productTokens = tokenize(
      `${product.name} ${product.category} ${product.description}`
    );
    const similarity = calculateJaccard(userTokens, productTokens);
    if (similarity > 0) {
      scored.push({
        product_id: product.id,
        score: similarity,
        reason: "content",
        product,
      });
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, topN);
}

async function getRecommendationsForUser(userId, { topN = 5 } = {}) {
  const [productRows] = await pool.query(
    "SELECT id, name, category, description, price, mrp FROM products WHERE (available_stock IS NULL OR available_stock != 'INVISIBLE') AND stock > 0"
  );
  const [orderRows] = await pool.query(
    `SELECT o.id, o.created_at, oi.product_id
     FROM orders o
     LEFT JOIN order_items oi ON oi.order_id = o.id
     WHERE o.user_id = ? AND o.status != 'Cancelled'
     ORDER BY o.created_at DESC`,
    [userId]
  );

  const catalog = productRows.map((product) => ({
    id: product.id,
    name: product.name,
    category: product.category,
    description: product.description || "",
  }));

  const userPurchases = orderRows
    .filter((row) => row.product_id != null)
    .map((row) => row.product_id);

  const allOrders = [];
  const orderMap = new Map();

  for (const row of orderRows) {
    if (!orderMap.has(row.id)) {
      orderMap.set(row.id, {
        id: row.id,
        created_at: row.created_at,
        items: [],
      });
      allOrders.push(orderMap.get(row.id));
    }
    if (row.product_id != null) {
      orderMap.get(row.id).items.push({ product_id: row.product_id });
    }
  }

  const coPurchaseMap = new Map();
  for (const order of allOrders) {
    const products = (order.items || [])
      .map((item) => item.product_id)
      .filter(Boolean);
    for (const current of products) {
      for (const other of products) {
        if (current === other) continue;
        const total = (coPurchaseMap.get(other) || 0) + 1;
        coPurchaseMap.set(other, total);
      }
    }
  }

  const categoryAffinity = new Map();
  const categoryWeights = new Map();
  for (const order of allOrders) {
    const products = (order.items || [])
      .map((item) => item.product_id)
      .filter(Boolean);
    for (const productId of products) {
      const product = catalog.find((item) => item.id === productId);
      if (!product) continue;
      const current = categoryWeights.get(product.category) || 0;
      categoryWeights.set(product.category, current + 1);
    }
  }
  for (const [category, count] of categoryWeights.entries()) {
    categoryAffinity.set(category, count);
  }

  const popularityMap = new Map();
  for (const order of allOrders) {
    for (const item of order.items || []) {
      const current = popularityMap.get(item.product_id) || 0;
      popularityMap.set(item.product_id, current + 1);
    }
  }

  const behavioral = getBehavioralRecommendations({
    userProductIds: userPurchases,
    catalog,
    allOrders,
    topN,
  });

  const scoredCandidates = scoreRecommendationCandidates({
    userProductIds: userPurchases,
    catalog,
    coPurchaseMap,
    categoryAffinity,
    popularityMap,
    topN: topN * 2,
  });

  const content = getContentRecommendations({
    userProducts: catalog.filter((product) =>
      userPurchases.includes(product.id)
    ),
    catalog,
    topN,
  });

  const combined = new Map();
  for (const item of behavioral) {
    combined.set(item.product_id, { ...item, score: item.score + 0.1 });
  }
  for (const item of scoredCandidates) {
    const existing = combined.get(item.product_id);
    if (existing) {
      existing.score += item.score;
      existing.reason = `${existing.reason}+${item.reason}`;
    } else {
      combined.set(item.product_id, { ...item, score: item.score });
    }
  }
  for (const item of content) {
    const existing = combined.get(item.product_id);
    if (existing) {
      existing.score += item.score;
    } else {
      combined.set(item.product_id, { ...item, score: item.score });
    }
  }

  return Array.from(combined.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map((item) => ({
      ...item,
      product: item.product || productMapLookup(catalog, item.product_id),
    }));
}

function productMapLookup(catalog, productId) {
  return catalog.find((product) => product.id === productId) || null;
}

export {
  getBehavioralRecommendations,
  getContentRecommendations,
  scoreRecommendationCandidates,
  getRecommendationsForUser,
};
