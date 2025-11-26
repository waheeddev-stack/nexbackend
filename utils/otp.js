import bcrypt from "bcryptjs";

export function generateOtpCode(length = 6) {
  const min = 10 ** (length - 1);
  const max = 10 ** length - 1;
  return String(Math.floor(Math.random() * (max - min + 1) + min));
}

export async function hashOtp(otp) {
  return await bcrypt.hash(otp, 10);
}

export async function verifyOtpHash(otp, hash) {
  return await bcrypt.compare(otp, hash);
}