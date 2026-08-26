/**
 * Revenue System - Bill Generation Logic
 */

/**
 * Filter valid orders (status: COMPLETED or DELIVERED, case-insensitive) and sum their value.
 * Supports both database field `total_amount` and mock data field `value`.
 *
 * @param {Array} orders - List of order objects
 * @returns {number} Total valid revenue
 */
export function calculateTotalRevenue(orders) {
  if (!Array.isArray(orders)) return 0;

  const totalRevenue = orders
    .filter((order) => {
      const status = (order.status || "").toUpperCase();
      return status === "COMPLETED" || status === "DELIVERED";
    })
    .reduce((total, order) => {
      const val =
        order.value !== undefined ? order.value : order.total_amount || 0;
      return total + Number(val);
    }, 0);

  return Math.round(totalRevenue);
}

/**
 * Determine platform fee percentage and fee amount based on revenue brackets.
 *
 * Brackets:
 * - 0 to 29,999: 0%
 * - 30,000 to 99,999: 2.0%
 * - 100,000 to 199,999: 2.5%
 * - 200,000 to 299,999: 3.0%
 * - 300,000+: 3.5%
 *
 * @param {number} totalRevenue - Gross revenue of the shopkeeper
 * @returns {object} Object containing feePercentage, feeAmount, and slabLabel
 */
export function calculatePlatformFee(totalRevenue) {
  let feePercentage = 0;
  let slabLabel = "";

  if (totalRevenue < 30000) {
    feePercentage = 0;
    slabLabel = "₹0 - ₹29,999 → 0%";
  } else if (totalRevenue >= 30000 && totalRevenue < 100000) {
    feePercentage = 2.0;
    slabLabel = "₹30k - ₹99,999 → 2%";
  } else if (totalRevenue >= 100000 && totalRevenue < 200000) {
    feePercentage = 2.5;
    slabLabel = "₹1L - ₹1,99,999 → 2.5%";
  } else if (totalRevenue >= 200000 && totalRevenue < 300000) {
    feePercentage = 3.0;
    slabLabel = "₹2L - ₹2,99,999 → 3%";
  } else if (totalRevenue >= 300000) {
    feePercentage = 3.5;
    slabLabel = "₹3L+ → 3.5%";
  }

  const feeAmount = Math.round((totalRevenue * feePercentage) / 100);

  return {
    feePercentage: feePercentage,
    feeAmount: feeAmount,
    slabLabel: slabLabel,
  };
}

/**
 * Generate final receipt/bill for a shopkeeper.
 *
 * @param {string|number} shopkeeperId - The ID of the shopkeeper
 * @param {Array} orders - List of order objects
 * @returns {object} Calculated bill details
 */
export function generateBill(shopkeeperId, orders) {
  const totalRevenue = calculateTotalRevenue(orders);
  const feeDetails = calculatePlatformFee(totalRevenue);

  const completedCount = orders.filter((order) => {
    const status = (order.status || "").toUpperCase();
    return status === "COMPLETED" || status === "DELIVERED";
  }).length;

  return {
    shopkeeperId: shopkeeperId,
    totalOrdersProcessed: completedCount,
    grossRevenue: totalRevenue,
    platformFeePercentage: `${feeDetails.feePercentage}%`,
    platformFeeAmount: feeDetails.feeAmount,
    netPayoutToShopkeeper: Math.round(totalRevenue - feeDetails.feeAmount),
    generatedAt: new Date().toISOString(),
  };
}
