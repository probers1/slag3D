# Authentication API Documentation

## Token Lifetime Changes (v2)

### Overview
- **Access tokens**: 1 hour (replaced from 24h for better security)
- **Refresh tokens**: 7 days with database-backed revocation

### Endpoints

#### POST /api/auth/login
Authenticates user and returns both access + refresh tokens.

**Response:**
```json
{
  "user": {
    "id": "uuid-here",
    "username": "admin",
    "role": "admin"
  },
  "accessToken": "...",
  "refreshToken": "...",
  "expiresIn": "1h"
}
```

#### POST /api/auth/refresh
Exchanges a refresh token for new access + refresh token pair. Used when access token expires.

**Request Header:**
```
Authorization: Bearer <refresh_token>
```

**Response:**
```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "expiresIn": "1h"
}
```

#### POST /api/auth/logout
Invalidates the current refresh token in the database and destroys session.

**Request Header:**
```
Authorization: Bearer <any_active_token>
```

### Security Improvements

1. **Shorter access tokens**: 1h vs 24h reduces window for stolen token attacks
2. **Refresh token rotation**: Each refresh creates new token, invalidating old one
3. **Database-backed revocation**: Tokens can be invalidated on logout
4. **Separate secrets**: Access tokens use standard secret; refresh tokens use separate key

### Client Implementation Tips

```javascript
// Store refresh token securely
let accessToken = '';
let refreshToken = '';

// When access token expires:
async function handleTokenExpiry() {
  const response = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${refreshToken}`,
      'Content-Type': 'application/json'
    }
  });
  
  const data = await response.json();
  accessToken = data.accessToken;
  refreshToken = data.refreshToken;
}

// Logout invalidates both tokens
await fetch('/api/auth/logout', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});
```

## Migration Notes

### For existing deployments
- No breaking changes to login flow - backward compatible
- Old 24h tokens will continue working until expiry
- New clients should request both tokens on login
- Consider updating frontend to use refresh endpoint after token expiry

### Environment Variables
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Yes* | - | Access token signing key |
| `REFRESH_TOKEN_SECRET` | No* | Random | Refresh token signing key |

\* Auto-generated on server start for REFRESH_TOKEN_SECRET if not set
