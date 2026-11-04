import React, { useState } from 'react';
import { Box, Lock, User as UserIcon, AlertCircle, ArrowRight } from 'lucide-react';
import { ErrorBoundary } from './ErrorBoundary';
import { User } from '../types';
import { apiFetch, setStoredToken, setStoredUser, setStoredCsrfToken } from '../utils/api';

interface LoginModalProps {
  onLoginSuccess: (user: User) => void;
  onClose?: () => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ onLoginSuccess, onClose }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');

      // Store the access token for future API requests (fallback auth)
      if (data.accessToken) {
        setStoredToken(data.accessToken);
      }

      // Store the CSRF token for double-submit validation on state-changing requests
      if (data.csrfToken) {
        setStoredCsrfToken(data.csrfToken);
      }

      // Store user info
      if (data.user) {
        setStoredUser(data.user);
      }

      // Notify parent of login success and close modal
      setTimeout(() => {
        onLoginSuccess(data.user);
        if (onClose) onClose();
      }, 100);

    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ErrorBoundary>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
        <div className="bg-[#18181e] border border-[#2d2d38] rounded-2xl w-full max-w-md p-6 sm:p-8 flex flex-col shadow-2xl">
          <div className="flex flex-col items-center text-center mb-6">
            <div className="w-12 h-12 rounded-xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400 mb-3">
              <Box className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold text-white font-['Plus_Jakarta_Sans',sans-serif]">
              Sign in to <span className="text-blue-500">SLAG3D</span>
            </h2>
            <p className="text-xs text-neutral-400 mt-1">
              Storage, Library, & Asset Grid for 3D Printing
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-950/40 border border-red-800/60 rounded-xl text-xs text-red-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1">Username</label>
              <div className="relative">
                <UserIcon className="w-4 h-4 text-neutral-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-[#131317] border border-[#343444] rounded-lg pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-neutral-500 absolute left-3 top-2.5" />
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-[#131317] border border-[#343444] rounded-lg pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 flex items-center justify-center gap-2 w-full py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg shadow-lg shadow-blue-600/20 transition-all"
            >
              <span>{loading ? 'Authenticating...' : 'Sign In'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      </div>
    </ErrorBoundary>
  );
};
