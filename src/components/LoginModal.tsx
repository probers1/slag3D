import React, { useState } from 'react';
import { Box, Lock, User as UserIcon, AlertCircle, ArrowRight } from 'lucide-react';
import { User } from '../types';
import { apiFetch, setStoredToken, setStoredUser } from '../utils/api';

interface LoginModalProps {
  onLoginSuccess: (user: User) => void;
  onClose?: () => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ onLoginSuccess, onClose }) => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
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

      if (data.token) {
        setStoredToken(data.token);
      }
      if (data.user) {
        setStoredUser(data.user);
      }

      onLoginSuccess(data.user);
      if (onClose) onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fillAdmin = () => {
    setUsername('admin');
    setPassword('admin123');
  };

  return (
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

        {/* Default credentials hint */}
        <div className="mt-6 pt-4 border-t border-[#262632] flex items-center justify-between text-xs text-neutral-400">
          <div>
            <span className="text-[11px] text-neutral-500">Default Admin:</span>{' '}
            <span className="font-mono text-neutral-300">admin</span> / <span className="font-mono text-neutral-300">admin123</span>
          </div>
          <button
            type="button"
            onClick={fillAdmin}
            className="text-[11px] text-blue-400 hover:underline"
          >
            Auto-fill
          </button>
        </div>
      </div>
    </div>
  );
};
