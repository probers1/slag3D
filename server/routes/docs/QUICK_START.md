# Quick Start - New Two-Token Authentication System

## What Changed?
- Login now returns **both** access and refresh tokens
- Access tokens expire in 1h (not 24+) 
- Refresh API at `/api/auth/refresh` to get new pair

## For Frontend Developers

### React Example
```jsx
import { useState, useEffect } from 'react';

function Dashboard() {
  const [accessToken, setAccessToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');

  // Initial login
  useEffect(() => {
    login();
  }, []);

  async function login() {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    const data = await res.json();
    
    setAccessToken(data.accessToken);
    setRefreshToken(data.refreshToken);
  }

  // Refresh token when needed
  function useCurrentTokens() {
    if (!accessToken || accessTokenExpiringSoon()) {
      refreshTokens();
    }
    return { accessToken, refreshToken };
  }

  async function refreshTokens() {
    if (refreshToken) {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${refreshToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (res.status === 200) {
        const data = await res.json();
        setAccessToken(data.accessToken);
        setRefreshToken(data.refreshToken);
      } else {
        // Need to re-login - old refresh token invalid
        setAccessToken('');
        setRefreshToken('');
        login();
      }
    }
  }

  return <div>...</div>;
}
```

### Vue Example
```vue
<script setup>
import { ref } from 'vue';

const accessToken = ref('');
const refreshToken = ref('');

// Refresh function
const refreshTokens = async () => {
  if (refreshToken.value) {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${refreshToken.value}`
      }
    });

    if (res.status === 200) {
      const data = await res.json();
      accessToken.value = data.accessToken;
      refreshToken.value = data.refreshToken;
    } else {
      // Token rotated - re-login needed
      accessToken.value = '';
      refreshToken.value = '';
    }
  }
};

// Auto-refresh on mount
onMounted(() => {
  // Initial login logic here
});
</script>
```

## For Backend/API Consumers

### Node.js/Express
```javascript
// Use both tokens as needed
const apiHeaders = {
  Authorization: `Bearer ${accessToken}`  // Access token for requests
};

// Or use refresh endpoint
async function refreshIfNeeded() {
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { Authorization: `Bearer ${refreshToken}` }
    });

    if (!res.ok) throw new Error('Auth failed');

    const { accessToken: newAcc, refreshToken: newRef } = await res.json();
    accessToken = newAcc;
    refreshToken = newRef;  // New token for future requests
  } catch (err) {
    console.log('Token expired, re-authenticating...');
    // Re-login
  }
}
```

### Python Requests
```python
import requests

response = requests.post(
    'http://localhost:3000/api/auth/login',
    json={'username': 'admin', 'password': 'admin123'}
)

data = response.json()
access_token = data['accessToken']
refresh_token = data['refreshToken']

# Refresh when needed
headers = {'Authorization': f'Bearer {refresh_token}'}
refresh_resp = requests.post('http://localhost:3000/api/auth/refresh', headers=headers)

if refresh_resp.status_code == 200:
    new_data = refresh_resp.json()
    access_token = new_data['accessToken']
    refresh_token = new_data['refreshToken']
```

### cURL
```bash
# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  | jq '.accessToken, .refreshToken'

# Refresh when access token expires
curl -X POST http://localhost:3000/api/auth/refresh \
  -H "Authorization: Bearer YOUR_REFRESH_TOKEN"

# Logout
curl -X POST http://localhost:3000/api/auth/logout \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## Troubleshooting

### "Invalid refresh token" 
- Token may have been rotated (old one expired)
- Refresh after logout (logout revokes current refresh)
- Re-login if multiple tabs/instances active

### "Refresh token not found or expired" in logs
- Token was used, then rotated (correct behavior)
- Check `auth_tokens` table in database

### Frequent 401 errors
- Check for clock synchronization issues
- Multiple clients using same refresh token
- Possible brute force attempt - investigate access patterns

## Best Practices

1. **Store tokens securely**
   ```javascript
   // Short-lived access tokens: memory or sessionStorage
   localStorage.setItem('accessToken', accessToken);  // OK with expiry tracking
   
   // Refresh tokens: secure storage
   // Consider encrypted localStorage or memory storage
   sessionStorage.setItem('refreshToken', refreshToken);
   ```

2. **Refresh before expiry, not at**
   ```javascript
   function checkAndRefresh() {
     const now = Date.now();
     const exp = new Date(header['exp']).getTime();
     if (exp - now > 1800000) {  // 30 min buffer
       refreshTokens();
     }
   }
   ```

3. **Handle token rotation gracefully**
   ```javascript
   try {
     const res = await refresh();
     if (res.ok) updateTokens(res.json());
     else reloginIfNecessary();
   } catch (err) {
     console.error('Token refresh failed', err);
   }
   ```

---
For more details, see:
- `SERVER_IMPROVEMENTS_SUMMARY.md`
- `server/routes/docs/auth-swagger.md`
- `server/routes/docs/README.md`
