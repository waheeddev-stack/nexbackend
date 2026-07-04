// Centralized Wellness Points Logic for Backend
// Updated: December 2024
// Points: 40, 30, 10, 5 | Coin Value: ₹0.05

// Calculate wellness points based on delivery time performance
// timeRemaining: positive = arrived early, negative = arrived late
const calculateWellnessPoints = (
  timeRemaining,
  totalDuration = 7 * 60 * 1000
) => {
  // Convert to minutes (can be negative)
  const minutesRemaining = timeRemaining / (60 * 1000);

  // Award points based on how much time is LEFT when customer arrives
  if (minutesRemaining >= 5) {
    // Arrived with 5+ minutes remaining = Super Fast
    return {
      points: 40,
      tier: "Super Fast",
      description: "Arrived with 5+ min left",
    };
  } else if (minutesRemaining >= 2) {
    // Arrived with 2-5 minutes remaining = Good Pace
    return {
      points: 30,
      tier: "Good Pace",
      description: "Arrived with 2-5 min left",
    };
  } else if (minutesRemaining >= 0) {
    // Arrived with 0-2 minutes remaining = On Time
    return {
      points: 10,
      tier: "On Time",
      description: "Arrived with 0-2 min left",
    };
  } else {
    // Arrived after timer expired = Late but Active
    return {
      points: 5,
      tier: "Late but Active",
      description: "Arrived after timer expired",
    };
  }
};

// Get point value in rupees
const getPointValue = () => 0.25; // ₹0.05 per point

// Calculate maximum points allowed (30% of order value)
const calculateMaxPointsAllowed = (availablePoints, totalAmount) => {
  const maxFromAmount = Math.floor(totalAmount / getPointValue() * 0.3);
  return Math.min(availablePoints, maxFromAmount);
};

// Convert points to rupees
const pointsToRupees = (points) => points * getPointValue();

// Convert rupees to points
const rupeesToPoints = (rupees) => Math.floor(rupees / getPointValue());

// Format points for display
const formatPoints = (points) => {
  return `${points} points (₹${pointsToRupees(points).toFixed(2)})`;
};

// Calculate discount from points
const calculateDiscount = (points) => {
  return pointsToRupees(points);
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
    return {
      valid: false,
      message: `Maximum ${maxAllowed} points allowed (30% of order value)`,
    };
  }

  return { valid: true, message: "Valid points selection" };
};

// Award wellness points for order completion
const awardWellnessPoints = async (
  pool,
  userId,
  deliveryTime,
  timerStartedAt,
  orderAmount = 0,
  deliveryType = "pickup"
) => {
  try {
    // ✅ NEW: Check if order amount is at least ₹40
    const MINIMUM_ORDER_AMOUNT = 40;
    if (orderAmount < MINIMUM_ORDER_AMOUNT) {
      console.log(
        `Order amount ₹${orderAmount} is below minimum ₹${MINIMUM_ORDER_AMOUNT}. No credits awarded.`
      );
      return {
        points: 0,
        tier: "Below Minimum",
        description: `Order amount must be at least ₹${MINIMUM_ORDER_AMOUNT} to earn credits`,
      };
    }

    // ✅ NEW: For home delivery, cap credits at 40 points (₹2)
    const MAX_HOME_DELIVERY_CREDITS = 40;
    const isHomeDelivery =
      deliveryType === "delivery" || deliveryType === "home_delivery";

    // Calculate time remaining based on timer
    const timerStart = new Date(timerStartedAt);
    const deliveredTime = new Date(deliveryTime);
    const timerDuration = 7 * 60 * 1000; // 7 minutes in milliseconds
    const timerExpires = new Date(timerStart.getTime() + timerDuration);

    // Time remaining = timer expiry - actual delivery time
    // Positive = on time, Negative = late
    const timeRemaining = timerExpires - deliveredTime;

    let pointsData = calculateWellnessPoints(timeRemaining, timerDuration);

    // Cap home delivery credits at 40 points
    if (isHomeDelivery && pointsData.points > MAX_HOME_DELIVERY_CREDITS) {
      pointsData = {
        ...pointsData,
        points: MAX_HOME_DELIVERY_CREDITS,
        tier: "Home Delivery (Capped)",
        description: `Home delivery maximum credits: ${MAX_HOME_DELIVERY_CREDITS} points`,
      };
    }

    console.log(`Wellness Points Calculation:
      - Timer Started: ${timerStart.toISOString()}
      - Timer Expires: ${timerExpires.toISOString()}
      - Delivered At: ${deliveredTime.toISOString()}
      - Time Remaining: ${Math.floor(timeRemaining / 1000)}s (${Math.floor(timeRemaining / 60000)} min)
      - Order Amount: ₹${orderAmount}
      - Delivery Type: ${deliveryType}
      - Points Awarded: ${pointsData.points} (${pointsData.tier})`);

    // Update user's store credits
    // ✅ FIX: Use COALESCE to handle NULL values (NULL + X = NULL in SQL)
    console.log(
      `Updating credits: userId=${userId}, points=${pointsData.points}`
    );
    const [result] = await pool.query(
      "UPDATE users SET store_credits = COALESCE(store_credits, 0) + ? WHERE id = ?",
      [pointsData.points, userId]
    );
    console.log(
      `Update result: affectedRows=${result.affectedRows}, changedRows=${result.changedRows}`
    );

    // Verify the update
    const [[user]] = await pool.query(
      "SELECT store_credits FROM users WHERE id = ?",
      [userId]
    );
    console.log(
      `Verified credits after update: ${user?.store_credits || "NOT FOUND"}`
    );

    return pointsData;
  } catch (error) {
    console.error("Error awarding wellness points:", error);
    throw error;
  }
};

// Deduct points for order payment
const deductWellnessPoints = async (pool, userId, pointsToDeduct) => {
  try {
    // Check if user has enough points
    const [user] = await pool.query(
      "SELECT store_credits FROM users WHERE id = ?",
      [userId]
    );

    if (user.length === 0) {
      throw new Error("User not found");
    }

    if (user[0].store_credits < pointsToDeduct) {
      throw new Error("Insufficient wellness points");
    }

    // Deduct points
    await pool.query(
      "UPDATE users SET store_credits = store_credits - ? WHERE id = ?",
      [pointsToDeduct, userId]
    );

    return {
      success: true,
      pointsDeducted: pointsToDeduct,
      discountAmount: calculateDiscount(pointsToDeduct),
      remainingPoints: user[0].store_credits - pointsToDeduct,
    };
  } catch (error) {
    console.error("Error deducting wellness points:", error);
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
