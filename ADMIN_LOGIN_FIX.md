# Admin Login JWE Token Fix

## Problem Identified

The admin login was failing due to a **token format mismatch**:

- **Login endpoint** (`routes/adminRoute.js`) was creating **JWE tokens** (encrypted JWT)
- **Auth middleware** (`middleware/adminAuth.js`) was trying to verify them as **regular JWT tokens**

This caused all admin authentication to fail after login.

## Solution Applied

### 1. Updated Admin Authentication Middleware

**File**: `nexbackend/middleware/adminAuth.js`

**Changes**:
- Added import for `verifyJWEToken` from `utils/jweToken.js`
- Modified token verification to try JWE format first
- Added fallback to regular JWT for backward compatibility
- Improved error handling for different token error types

**Key Code**:
```javascript
// Try to verify as JWE token first (new format)
let decoded;
try {
  decoded = await verifyJWEToken(token);
} catch (jweError) {
  // If JWE verification fails, try as regular JWT (backward compatibility)
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (jwtError) {
    throw jweError; // Throw the original JWE error
  }
}
```

### 2. Environment Configuration

**File**: `nexbackend/.env.example`

**Requirements**:
- `JWT_SECRET` must be **at least 32 characters** (required for JWE encryption)
- `ADMIN_EMAIL` and `ADMIN_PASSWORD` for admin authentication

**Default Credentials** (if env vars not set):
- Email: `nexkirana@kirana.com`
- Password: `qwI41L5U47RwaI47DasA`

### 3. Testing Script

**File**: `nexbackend/scripts/test-admin-login.js`

Run this script to verify the fix:
```bash
cd nexbackend
node scripts/test-admin-login.js
```

## How to Deploy the Fix

### For Render.com Deployment:

1. **Update Environment Variables**:
   - Go to your Render dashboard
   - Navigate to your `nexbackend` service
   - Add/update these environment variables:
     ```
     JWT_SECRET=your-super-secret-jwt-key-at-least-32-characters-long
     ADMIN_EMAIL=nexkirana@kirana.com
     ADMIN_PASSWORD=qwI41L5U47RwaI47DasA
     ```

2. **Deploy the Updated Code**:
   - Commit and push the changes to your repository
   - Render will automatically redeploy
   - Or manually trigger a deploy from the Render dashboard

3. **Verify the Fix**:
   - Try logging into the admin panel at `admin-1`
   - Use the credentials from your environment variables
   - Check the browser console for any errors

### For Local Development:

1. **Create `.env` file**:
   ```bash
   cd nexbackend
   cp .env.example .env
   ```

2. **Edit `.env` with your values**:
   ```env
   JWT_SECRET=your-super-secret-jwt-key-at-least-32-characters-long
   ADMIN_EMAIL=nexkirana@kirana.com
   ADMIN_PASSWORD=qwI41L5U47RwaI47DasA
   # ... other variables
   ```

3. **Start the server**:
   ```bash
   npm start
   ```

4. **Run the test**:
   ```bash
   node scripts/test-admin-login.js
   ```

## Login Credentials

### Default (Fallback):
- **Email**: `nexkirana@kirana.com`
- **Password**: `qwI41L5U47RwaI47DasA`

### Flexible Email Matching:
The login endpoint accepts emails containing:
- "nexkirana" (e.g., `admin@nexkirana.com`)
- "admin" (e.g., `admin@admin.com`)

But the password must match exactly.

## Technical Details

### JWE Token Format

The system now uses **JWE (JSON Web Encryption)** tokens for enhanced security:

- **Algorithm**: `dir` (Direct Key Agreement)
- **Encryption**: `A256GCM` (AES-256 Galois/Counter Mode)
- **Expiration**: 24 hours for admin tokens
- **Payload**: `{ id, email, role: 'admin', iat, exp, jti }`

### Token Verification Flow

1. Extract token from `Authorization: Bearer <token>` header
2. Try to decrypt as JWE token
3. If JWE fails, try as regular JWT (backward compatibility)
4. Validate token claims (role, expiration, etc.)
5. For admin ID 1, skip database lookup (environment-based admin)
6. For other admins, verify against database

## Troubleshooting

### Issue: "Invalid token" error

**Cause**: JWT_SECRET mismatch or not set

**Solution**: 
- Ensure `JWT_SECRET` is set in environment variables
- Must be at least 32 characters
- Must be the same value used when creating tokens

### Issue: "Token expired" error

**Cause**: Token has expired (24 hours for admin)

**Solution**: 
- Log in again to get a new token
- Consider increasing token expiration in `adminRoute.js` line 1445

### Issue: "Invalid credentials" error

**Cause**: Wrong email or password

**Solution**:
- Check environment variables `ADMIN_EMAIL` and `ADMIN_PASSWORD`
- Use default credentials if env vars not set
- Check server logs for email/password mismatch details

## Files Modified

1. ✅ `nexbackend/middleware/adminAuth.js` - Fixed token verification
2. ✅ `nexbackend/.env.example` - Updated with proper configuration
3. ✅ `nexbackend/scripts/test-admin-login.js` - Created test script
4. ✅ `nexbackend/ADMIN_LOGIN_FIX.md` - This documentation

## Next Steps

1. Deploy the updated code to Render
2. Update environment variables on Render
3. Test admin login from `admin-1` panel
4. Monitor server logs for any issues
5. Consider implementing token refresh mechanism for better UX
