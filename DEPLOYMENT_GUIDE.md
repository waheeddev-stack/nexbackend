# Deployment Guide - Render

## Recent Fixes Pushed (March 8, 2026)

### 1. Password Reset Email Fix
- **Commit:** `07c8348`
- **Issue:** nodemailer ES module import issue
- **Fix:** Enhanced module resolution and error handling

### 2. Missing token.js Module Fix
- **Commit:** `34e3fe4`
- **Issue:** `Cannot find module '/opt/render/project/src/utils/token.js'`
- **Fix:** Replaced non-existent `utils/token.js` with `utils/jweToken.js`

## How to Deploy on Render

### Option 1: Automatic Deployment (Recommended)
Render should automatically deploy when you push to the master branch. If it doesn't:

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Find your `nexbackend` service
3. Click on the service
4. Click "Manual Deploy" → "Deploy latest commit"
5. Wait for deployment to complete (usually 2-5 minutes)

### Option 2: Force Redeploy
If automatic deployment isn't working:

1. Go to Render Dashboard
2. Select your service
3. Go to "Settings"
4. Scroll to "Build & Deploy"
5. Click "Clear build cache & deploy"

### Option 3: Trigger via Git
Sometimes a new commit triggers deployment:

```bash
# Make a trivial change
echo "# Trigger deployment" >> README.md
git add README.md
git commit -m "Trigger Render deployment"
git push origin master
```

## Verify Deployment

After deployment completes, verify the fixes:

### 1. Check Server Logs
```bash
# In Render Dashboard → Logs
# Look for:
# - No "Cannot find module" errors
# - Server starts successfully
# - "[EMAIL]" and "[PASSWORD-RESET]" log prefixes appear
```

### 2. Test Password Reset
```bash
# From your local machine
curl -X POST https://nexbackend.onrender.com/api/password-reset/request \
  -H "Content-Type: application/json" \
  -d '{"email":"waheedwork12@gmail.com"}'
```

Expected response:
```json
{
  "success": true,
  "message": "If an account exists with this email, you will receive a password reset link shortly."
}
```

### 3. Test Google OAuth
The Google OAuth routes should now work without the token.js error.

## Deployment Checklist

- [ ] Latest code pushed to GitHub master branch
- [ ] Render deployment triggered (automatic or manual)
- [ ] Deployment completed successfully (check Render logs)
- [ ] No module errors in logs
- [ ] Server started and listening on port
- [ ] Password reset API working
- [ ] Google OAuth working
- [ ] Email sending functional

## Common Deployment Issues

### Issue: Deployment Stuck
**Solution:** Cancel deployment and try again, or clear build cache

### Issue: Module Not Found After Deployment
**Solution:** 
1. Check if the file exists in the repository
2. Verify the import path is correct
3. Clear build cache and redeploy

### Issue: Environment Variables Missing
**Solution:**
1. Go to Render Dashboard → Service → Environment
2. Verify all required variables are set:
   - `EMAIL_USER`
   - `EMAIL_PASSWORD`
   - `DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME`
   - `JWT_SECRET`
   - `GOOGLE_CLIENT_ID`

### Issue: Old Code Still Running
**Solution:**
1. Check the deployment logs for the commit hash
2. Verify it matches your latest commit
3. If not, trigger a manual deploy

## Monitoring After Deployment

### Check Logs Regularly
```bash
# Look for these patterns in Render logs:
[EMAIL] ✅ Password reset email sent successfully
[PASSWORD-RESET] ✅ Password reset successful
```

### Monitor Error Rates
- Watch for any new errors in Render logs
- Check application metrics in Render dashboard
- Monitor response times

### Test Critical Paths
1. User registration
2. User login
3. Password reset flow
4. Google OAuth login
5. Order placement

## Rollback Procedure

If deployment causes issues:

1. Go to Render Dashboard → Service
2. Click "Rollback" button
3. Select previous working deployment
4. Confirm rollback

Or via Git:
```bash
# Revert to previous commit
git revert HEAD
git push origin master
```

## Contact & Support

- **Repository:** https://github.com/waheeddev-stack/nexbackend
- **Latest Commit:** `34e3fe4`
- **Deployment Platform:** Render
- **Service URL:** https://nexbackend.onrender.com

## Next Steps After Deployment

1. ✅ Verify password reset works on mobile app
2. ✅ Test Google OAuth on mobile app
3. ✅ Monitor logs for 24 hours
4. ✅ Check email delivery rates
5. ✅ Verify all API endpoints working

---

**Last Updated:** March 8, 2026  
**Status:** Fixes pushed to GitHub, awaiting Render deployment
