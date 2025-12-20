// Centralized Wellness Points Logic for Backend
// Updated: December 2024
// Points: 40, 30, 10, 5 | Coin Value: ₹0.05

// Calculate wellness points based on delivery time performance
// timeRemaining: positive = arrived early, negative = arrived late
const calculateWellnessPoints = (timeRemaining, totalDuration = 7 * 60 * 1000) => {
  // Convert to minutes (can be negative)
  const minutesRemaining = timeRemaining / (60 * 1000);
  
  // Award points based on how much time is LEFT when customer arrives
  if (minutesRemaining >= 5) {
    // Arrived with 5+ minutes remaining = Super Fast
    return { points: 40, tier: "Super Fast", description: "Arrived with 5+ min left" };
  } else if (minutesRemaining >= 2) {
    // Arrived with 2-5 minutes remaining = Good Pace
    return { points: 30, tier: "Good Pace", description: "Arrived with 2-5 min left" };
  } else if (minutesRemaining >= 0) {
    // Arrived with 0-2 minutes remaining = On Time
    return { points: 10, tier: "On Time", description: "Arrived with 0-2 min left" };
  } else {
    // Arrived after timer expired = Late but Active
    return { points: 5, tier: "Late but Active", description: "Arrived after timer expired" };
  }
};

// Get point value in rupees
const getPointValue = () => 0.05; // ₹0.05 per point

// Calculate maximum points that can be used (10% of order value)
const calculateMaxPointsAllowed = (availablePoints, totalAmount) => {
  // Use integer arithmetic to avoid floating-point precision issues
  // 10% of order value = totalAmount * 0.1
  // Points = (totalAmount * 0.1) / 0.05 = totalAmount * 0.1 / 0.05 = totalAmount * 2
  // To avoid decimals: (totalAmount * 10) / 5 = totalAmount * 2
  const maxFromOrderValue = Math.floor(totalAmount * 2);
  return Math.min(availablePoints, maxFromOrderValue);
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
const awardWellnessPoints = async (pool, userId, deliveryTime, timerStartedAt) => {
  try {
    // Calculate time remaining based on timer
    const timerStart = new Date(timerStartedAt);
    const deliveredTime = new Date(deliveryTime);
    const timerDuration = 7 * 60 * 1000; // 7 minutes in milliseconds
    const timerExpires = new Date(timerStart.getTime() + timerDuration);
    
    // Time remaining = timer expiry - actual delivery time
    // Positive = on time, Negative = late
    const timeRemaining = timerExpires - deliveredTime;
    
    const pointsData = calculateWellnessPoints(timeRemaining, timerDuration);
    
    console.log(`Wellness Points Calculation:
      - Timer Started: ${timerStart.toISOString()}
      - Timer Expires: ${timerExpires.toISOString()}
      - Delivered At: ${deliveredTime.toISOString()}
      - Time Remaining: ${Math.floor(timeRemaining / 1000)}s (${Math.floor(timeRemaining / 60000)} min)
      - Points Awarded: ${pointsData.points} (${pointsData.tier})`);
    
    // Update user's store credits
    // ✅ FIX: Use COALESCE to handle NULL values (NULL + X = NULL in SQL)
    console.log(`Updating credits: userId=${userId}, points=${pointsData.points}`);
    const [result] = await pool.query(
      'UPDATE users SET store_credits = COALESCE(store_credits, 0) + ? WHERE id = ?',
      [pointsData.points, userId]
    );
    console.log(`Update result: affectedRows=${result.affectedRows}, changedRows=${result.changedRows}`);
    
    // Verify the update
    const [[user]] = await pool.query('SELECT store_credits FROM users WHERE id = ?', [userId]);
    console.log(`Verified credits after update: ${user?.store_credits || 'NOT FOUND'}`);
    
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