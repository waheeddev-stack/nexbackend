export function calculateTieredDiscount(totalAmount) {
  let rate = 0;
  if (totalAmount >= 1000) rate = 0.05;
  else if (totalAmount >= 500) rate = 0.03;
  else if (totalAmount >= 50) rate = 0.02;

  let totalDiscount = +(totalAmount * rate).toFixed(2);
  if (rate >= 0.05 && totalDiscount > 150) totalDiscount = 150;

  const instantDiscount = Math.floor((totalDiscount / 2) * 100) / 100;
  const walletCredit = +(totalDiscount - instantDiscount).toFixed(2);

  return { totalDiscount, instantDiscount, walletCredit, rate };
}
