const TOKEN_KEY = 'slag3d_auth_token';
const USER_KEY = 'slag3d_user';
const CSRF_TOKEN_KEY = 'slag3d_csrf_token';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null) {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {}
}

export function getStoredUser<T>(): T | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredUser<T>(user: T | null) {
  try {
    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(USER_KEY);
    }
  } catch {}
}

export function getStoredCsrfToken(): string | null {
  try {
    return localStorage.getItem(CSRF_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredCsrfToken(token: string | null) {
  try {
    if (token) {
      localStorage.setItem(CSRF_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(CSRF_TOKEN_KEY);
    }
  } catch {}
}

export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers || {});

  // Attach auth token from localStorage if available (fallback for frames, iframe scenarios)
  const storedToken = getStoredToken();
  if (storedToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${storedToken}`);
  }

  // Attach double-submit CSRF token from localStorage if available
  const storedCsrfToken = getStoredCsrfToken();
  if (storedCsrfToken) {
    headers.set('X-CSRF-Token', storedCsrfToken);
  }

  // Set credentials to include so session cookies are also transmitted when supported
  // Backend prefers cookies for same-origin, uses token for frames
  const config: RequestInit = {
    ...options,
    headers,
    credentials: 'include',
  };

  const response = await fetch(url, config);

  // If unauthorized (except /api/auth/me which returns no data on error), log warning
  if (response.status === 401 && !url.includes('/api/auth/me')) {
    console.warn(`[SLAG3D API] 401 Unauthorized for ${url}`);
  }

  return response;
}
