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
  
  return orders
    .filter(order => {
      const status = (order.status || '').toUpperCase();
      return status === 'COMPLETED' || status === 'DELIVERED';
    })
    .reduce((total, order) => {
      const val = order.value !== undefined ? order.value : (order.total_amount || 0);
      return total + Number(val);
    }, 0);
}

/**
 * Determine platform fee percentage and fee amount based on revenue brackets.
 * 
 * Brackets:
 * - 0 to 29,999: 0%
 * - 30,000 to 99,999: 2.0%
 * - 100,000 to 199,999: 2.5%
 * - 200,000+: 3.0%
 * 
 * @param {number} totalRevenue - Gross revenue of the shopkeeper
 * @returns {object} Object containing feePercentage and feeAmount
 */
export function calculatePlatformFee(totalRevenue) {
  let feePercentage = 0;

  if (totalRevenue < 30000) {
    feePercentage = 0; // 0 - 29,999
  } else if (totalRevenue >= 30000 && totalRevenue < 100000) {
    feePercentage = 2.0; // 30k - 99,999
  } else if (totalRevenue >= 100000 && totalRevenue < 200000) {
    feePercentage = 2.5; // 1L - 1,99,999
  } else if (totalRevenue >= 200000) {
    feePercentage = 3.0; // 2L and above
  }

  // Calculate the actual fee amount
  const feeAmount = (totalRevenue * feePercentage) / 100;
  
  return {
    feePercentage: feePercentage,
    feeAmount: feeAmount
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
  
  const completedCount = orders.filter(order => {
    const status = (order.status || '').toUpperCase();
    return status === 'COMPLETED' || status === 'DELIVERED';
  }).length;

  return {
    shopkeeperId: shopkeeperId,
    totalOrdersProcessed: completedCount,
    grossRevenue: totalRevenue,
    platformFeePercentage: `${feeDetails.feePercentage}%`,
    platformFeeAmount: feeDetails.feeAmount,
    netPayoutToShopkeeper: totalRevenue - feeDetails.feeAmount,
    generatedAt: new Date().toISOString()
  };
}
