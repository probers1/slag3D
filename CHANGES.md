# JWT Token Lifetime Improvement - Implementation Summary

## Problem Addressed
**Issue**: JWT tokens had 24h lifetime with no refresh mechanism, causing:
- Frequent user logouts
- Stolen tokens remaining valid for full day
- Poor user experience

## Solution Implemented
Implemented access+refresh token pattern:
- **Access tokens**: 1 hour (down from 24h)
- **Refresh tokens**: 7 days with DB-backed revocation
- **Token rotation**: Each refresh invalidates previous token

## Files Modified

### 1. `server/routes/auth.ts`
**Changes:**
- Added crypto import for secure token generation
- Created `TOKEN_CONFIG` constants for token lifetimes
- Implemented `generateAccessToken()` and `generateRefreshToken()` functions
- Added `verifyRefreshToken()` with DB validation
- Modified login endpoint to return both token types
- Added `/api/auth/refresh` endpoint for token renewal
- Updated logout to remove refresh tokens from database

**New API Response on Login:**
```json
{
  "user": { "id": "...", "username": "...", "role": "..." },
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "...",
  "expiresIn": "1h"
}
```

### 2. `server/middleware.ts`
**Changes:**
- Added crypto import
- Exported JWT and REFRESH_TOKEN_SECRET constants
- Updated `authResolverMiddleware()` to handle both token types
- Added refresh token detection and rotation logic
- Implemented background token rotation via `setRefreshTokenRotation()`

### 3. New Documentation
- Created `server/routes/docs/auth-swagger.md` with endpoint documentation

## Database Changes
No schema changes required - uses existing `auth_tokens` table:
```sql
CREATE TABLE IF NOT EXISTS auth_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Security Improvements

### Before (24h access tokens)
- Stolen token valid for entire day
- No way to revoke without logout
- Single token type

### After (1h access + 7d refresh)
- Minimized exposure window (1 hour)
- DB-backed revocation on logout/token rotation  
- Two-tier security with separate secrets

## Migration Notes

### For Existing Deployments
- **No breaking changes**: Old tokens continue working until expiry
- **Backward compatible**: Login returns both new token types
- **Graceful upgrade**: Old clients will eventually re-authenticate

### Client-Side Changes Required
```javascript
// Store both tokens
let { accessToken, refreshToken } = await login();

// When access token expires (after 1h), use refresh:
const response = await fetch('/api/auth/refresh', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${refreshToken}`,
    'Content-Type': 'application/json'
  }
});
const { accessToken: newAccessToken, refreshToken: newRefreshToken } = await response.json();

// Replace stored tokens
accessToken = newAccessToken;
refreshToken = newRefreshToken;
```

## Testing Checklist
- [x] Login returns both token types
- [x] Access token expires after 1h
- [x] Refresh endpoint generates new pair
- [x] Logout invalidates refresh token in DB
- [x] Middleware accepts both token types
- [x] Token rotation prevents reuse of old tokens
- [ ] Integration testing with real users

## Environment Variables
| Variable | Required Default | Description |
|----------|-----------------|-------------|
| `JWT_SECRET` | Optional* | Access token signing key |
| `REFRESH_TOKEN_SECRET` | Required | Refresh token secret (must be set) |

\* Auto-generated on server start for JWT_SECRET if not set; REFRESH_TOKEN_SECRET is required

## Rollback Plan
If issues arise, revert by:
1. Removing `/api/auth/refresh` endpoint
2. Reverting login to single 24h token
3. Running: `git checkout server/routes/auth.ts`

---

**Implementation Date**: Wed Oct 28 2026  
**Status**: Ready for staging deployment  
**Next Steps**: Deploy to staging, test with real users, monitor token metrics
