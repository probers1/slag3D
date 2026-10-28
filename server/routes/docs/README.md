# Authentication System Documentation - Version 2

## Overview
This directory contains documentation for the authentication system improvements.

## Files
- `README.md` - This file
- `auth-swagger.md` - API endpoint details
- `CHANGES.md` - Implementation notes (in repo root)

## Token Flow Diagram

```
┌─────────────┐
│   User      │
│  Login       │
└──────┬──────┘
       │
       ▼
┌────────────────────────────┐
│  /api/auth/login           │
├────────────────────────────┤
│  Returns:                  │
│  - accessToken (1h)        │
│  - refreshToken (7d) DB    │
└─────────────┬──────────────┘
              │
              ▼
    ┌─────────────────────┐
    │ Use accessToken     │
    └──────────┬──────────┘
               │ Expires (1h)
               ▼
    ┌─────────────────────┐
    │ /api/auth/refresh   │  Rotate tokens
    ├─────────────────────┤
    │ Returns:            │
    │ - accessToken (new) │
    │ - refreshToken (new)│
    └─────────────┬───────┘
                  │
                  ▼
         ┌────────────────┐
         │ Logout         │  Inval. refresh token
         └────────────────┘
```

## Quick Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/auth/login` | POST | Authenticate + get tokens |
| `/api/auth/refresh` | POST | Renew access+refresh tokens |
| `/api/auth/logout` | POST | Invalidate all tokens |

## Token Storage Recommendations

### Frontend (React/Vue/Angular)
```typescript
// Store in memory for current session only
const useAuth = async () => {
  const res = await fetch('/api/auth/login', ...);
  const { accessToken, refreshToken } = await res.json();
  
  // Store access token temporarily
  sessionStorage.setItem('accessToken', accessToken);
  
  // Persist refresh token more securely
  localStorage.setItem('refreshToken', refreshToken);
};

// Refresh when needed
const useTokenRefresh = async () => {
  const res = await fetch('/api/auth/refresh', {
    headers: { Authorization: `Bearer ${refreshToken}` }
  });
  
  if (res.status === 200) {
    const { accessToken, refreshToken } = await res.json();
    // Update storage
  } else {
    // Token was rotated/expired, re-login
    await refreshToken();
  }
};
```

## Rate Limiting Considerations
- Refresh endpoint should rate limit to prevent token brute force
- Recommended: Max 5 refresh attempts per hour per IP
- Monitor `/api/auth/refresh` success/failure ratios

## Monitoring Metrics to Track
1. Token expiry rate (access token usage after 45min)
2. Refresh endpoint error rates
3. Logout frequency spikes
4. Database `auth_tokens` table size

## Security Notes
- Always use HTTPS in production
- Keep `JWT_SECRET` and `REFRESH_TOKEN_SECRET` secure
- Rotate secrets every 90 days or after incident
- Monitor for token reuse attempts
