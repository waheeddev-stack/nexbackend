// Centralized Wellness Points Logic for Backend
// Updated: December 2024
// Points: 20, 15, 10, 5 | Coin Value: ₹0.05

// Calculate wellness points based on delivery time performance
const calculateWellnessPoints = (timeRemaining, totalDuration = 7 * 60 * 1000) => {
  const minutesRemaining = Math.floor(timeRemaining / (60 * 1000));
  
  if (minutesRemaining >= 5) {
    return { points: 20, tier: "Super Fast", description: "5+ min left" };
  } else if (minutesRemaining >= 2) {
    return { points: 15, tier: "Good Pace", description: "2+ min left" };
  } else if (minutesRemaining >= 0) {
    return { points: 10, tier: "On Time", description: "0-2 min left" };
  } else {
    return { points: 5, tier: "Late but Active", description: "Completed late" };
  }
};

// Get point value in rupees
const getPointValue = () => 0.05; // ₹0.05 per point

// Calculate maximum points that can be used (10% of order value)
const calculateMaxPointsAllowed = (availablePoints, totalAmount) => {
  return Math.min(
    availablePoints,
    Math.floor(totalAmount * 0.1 / getPointValue()) // 10% of order value divided by point value
  );
};

// Convert points to rupees
const pointsToRupees = (points) => {
  return points * getPointValue();
};

// Convert rupees to points
const rupeesToPoints = (rupees) => {
  return Math.floor(rupees / getPointValue());
};

// Format points display
const formatPoints = (points) => {
  return `${points} points (₹${pointsToRupees(points).toFixed(2)})`;
};

// Validate points usage
const validatePointsUsage = (selectedPoints, availablePoints, totalAmount) => {
  const maxAllowed = calculateMaxPointsAllowed(availablePoints, totalAmount);
  
  if (selectedPoints <= 0) {
    return { valid: false, message: "Please select points to use" };
  }
  
  if (selectedPoints > availablePoints) {
    return { valid: false, message: "Insufficient points available" };
  }
  
  if (selectedPoints > maxAllowed) {
    return { valid: false, message: `Maximum ${maxAllowed} points allowed (10% of order value)` };
  }
  
  return { valid: true, message: "Valid points selection" };
};

// Calculate discount from points
const calculateDiscount = (points) => {
  return pointsToRupees(points);
};

// Award wellness points for order completion
const awardWellnessPoints = async (pool, userId, deliveryTime, orderCreatedAt) => {
  try {
    const orderTime = new Date(orderCreatedAt);
    const deliveredTime = new Date(deliveryTime);
    const timeTaken = deliveredTime - orderTime;
    const timeRemaining = (7 * 60 * 1000) - timeTaken; // 7 minutes target - actual time
    
    const pointsData = calculateWellnessPoints(timeRemaining);
    
    // Update user's store credits
    await pool.query(
      'UPDATE users SET store_credits = store_credits + ? WHERE id = ?',
      [pointsData.points, userId]
    );
    
    return pointsData;
  } catch (error) {
    console.error('Error awarding wellness points:', error);
    throw error;
  }
};

// Deduct points for order payment
const deductWellnessPoints = async (pool, userId, pointsToDeduct) => {
  try {
    // Check if user has enough points
    const [user] = await pool.query('SELECT store_credits FROM users WHERE id = ?', [userId]);
    
    if (user.length === 0) {
      throw new Error('User not found');
    }
    
    if (user[0].store_credits < pointsToDeduct) {
      throw new Error('Insufficient wellness points');
    }
    
    // Deduct points
    await pool.query(
      'UPDATE users SET store_credits = store_credits - ? WHERE id = ?',
      [pointsToDeduct, userId]
    );
    
    return {
      success: true,
      pointsDeducted: pointsToDeduct,
      discountAmount: calculateDiscount(pointsToDeduct),
      remainingPoints: user[0].store_credits - pointsToDeduct
    };
  } catch (error) {
    console.error('Error deducting wellness points:', error);
    throw error;
  }
};

export {
  calculateWellnessPoints,
  getPointValue,
  calculateMaxPointsAllowed,
  pointsToRupees,
  rupeesToPoints,
  formatPoints,
  validatePointsUsage,
  calculateDiscount,
  awardWellnessPoints,
  deductWellnessPoints,
};

export default {
  calculateWellnessPoints,
  getPointValue,
  calculateMaxPointsAllowed,
  pointsToRupees,
  rupeesToPoints,
  formatPoints,
  validatePointsUsage,
  calculateDiscount,
  awardWellnessPoints,
  deductWellnessPoints,
};