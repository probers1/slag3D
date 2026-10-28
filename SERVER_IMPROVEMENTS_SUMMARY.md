# JWT Token Lifetime Improvement - Summary of Changes

## Issue Addressed
**Location**: `server/routes/auth.ts:34`  
**Problem**: JWT tokens expired in 24h with no refresh token mechanism  
**Risk**: 
- Users frequently logged out unexpectedly  
- Stolen tokens valid for entire day (24h)  
- Poor user experience and security  

## Solution Implemented

### New Token Strategy
1. **Access tokens**: 1 hour (down from 24h) for API calls
2. **Refresh tokens**: 7 days with database-backed revocation
3. **Token rotation**: Each refresh creates new, invalidates old token

### Endpoint Enhancements

#### POST /api/auth/login
**Response now includes:**
```json
{
  "user": { "id": "...", "username": "...", "role": "..." },
  "accessToken": "eyJhbGci...",           // Valid for 1h
  "refreshToken": "...",                   // Valid for 7d
  "expiresIn": "1h"
}
```

#### POST /api/auth/refresh (NEW)
**Purpose**: Exchange refresh token for new access+refresh pair  
**Usage**: When access token expires or just before expiry  
**Response:**
```json
{
  "accessToken": "...",                    // New 1h token
  "refreshToken": "...",                   // New 7d token (rotated)
  "expiresIn": "1h"
}
```

### Security Improvements

| Feature | Before | After |
|---------|--------|-------|
| Access token lifetime | 24+ hours | 1 hour |
| Refresh mechanism | None | 7-day refresh tokens |
| Token revocation | Logout only | DB-backed anytime |
| Token rotation | No | Automatic on refresh |
| Secrets per type | Single | Separate (access + refresh) |

### Files Modified

1. **server/routes/auth.ts** - Main authentication logic
   - Added token generation functions
   - Implemented token verification with rotation
   - New `/api/auth/refresh` endpoint
   
2. **server/middleware.ts** - Request validation  
   - Updated to handle both token types
   - Refresh token detection and rotation
   
3. **Documentation Created**:
   - `server/routes/docs/auth-swagger.md`
   - `server/routes/docs/README.md`

### Implementation Notes

#### For Existing Deployments
- ✅ No breaking changes - old tokens continue working
- ✅ Backward compatible with existing clients
- ✅ Graceful migration as old tokens expire

#### Migration Path for Clients
```javascript
// Step 1: Store both tokens after login
const { accessToken, refreshToken } = await response.json();

// Step 2: Refresh when needed
if (accessTokenExpiringSoon()) {
  const { accessToken: newAcc, refreshToken: newRef } = 
    await refreshTokens(refreshToken);
  
  accessToken = newAcc;
  refreshToken = newRef;
}

// Step 3: Logout invalidates both
await logout();
```

#### Monitoring Recommendations
- Watch for access token expiry rate (should be <5%)
- Monitor `/api/auth/refresh` success ratio
- Alert on consecutive refresh failures (possible brute force)
- Check DB `auth_tokens` table size growth

### Technical Details

#### Token Structure
**Access token payload:**
```javascript
{
  userId: "uuid",
  username: "admin",
  role: "admin"
}
```

**Refresh token structure (stored as plain JWT):**
```javascript
{
  data: "{random_hash}:{user_id}",
  exp: <timestamp>
}
```

#### Database Schema
Uses existing `auth_tokens` table - no migration needed:
```sql
CREATE TABLE auth_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  created_at DATETIME
);
```

### Testing Checklist
- [x] Login returns both token types
- [x] Access token expires after 1h
- [x] Refresh endpoint rotates tokens correctly  
- [x] Logout removes refresh token from DB
- [x] Middleware accepts both token type
- [x] TypeScript compilation succeeds (minor warnings acceptable)

### Environment Variables
```bash
# Production settings required:
export JWT_SECRET="your-secret-change-me"  # Required in prod
export REFRESH_TOKEN_SECRET="random-here"  # Optional, auto-generated if empty
```

## Next Steps
1. Deploy to staging environment
2. Monitor token metrics for 48 hours
3. Test refresh flow under load
4. Update frontend code to handle both token types
5. Production rollout

## Rollback Plan
If critical issues occur:
```bash
# Revert to original files
git checkout HEAD^ -- server/routes/auth.ts

# Restart server
npm run dev
```

---
**Implementation Date**: Wed Oct 28, 2026  
**Status**: ✅ Complete - Ready for staging  
**Impact**: Security improvement + UX enhancement  
**Breaking Changes**: None
