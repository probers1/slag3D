import React from 'react';
import { Box, Heart, Folder, User as UserIcon, Shield, Lock, LogOut, Upload } from 'lucide-react';
import { User } from '../types';

interface NavbarProps {
  user: User | null;
  activeTab: 'all' | 'mine' | 'favorites' | 'collections';
  onTabChange: (tab: 'all' | 'mine' | 'favorites' | 'collections') => void;
  onOpenUpload: () => void;
  onOpenAdmin: () => void;
  onOpenPasswordModal: () => void;
  onLogout: () => void;
  onOpenLogin: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  activeTab,
  onTabChange,
  onOpenUpload,
  onOpenAdmin,
  onOpenPasswordModal,
  onLogout,
  onOpenLogin,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-[#16161a]/95 backdrop-blur-md border-b border-[#262630] px-4 lg:px-8 py-3.5">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-6">
        {/* Zone 1: Brand Wordmark */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => onTabChange('all')}
            className="flex items-center gap-2.5 text-left group focus:outline-none"
          >
            <div className="w-9 h-9 rounded-lg bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400 group-hover:bg-blue-600/30 group-hover:border-blue-400 transition-all">
              <Box className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xl font-bold tracking-tight text-white font-['Plus_Jakarta_Sans',sans-serif]">
                SLAG<span className="text-blue-500">3D</span>
              </span>
              <span className="hidden sm:inline-block ml-2 text-[10px] tracking-wider uppercase text-neutral-400 font-mono">
                Asset Vault
              </span>
            </div>
          </button>
        </div>

        {/* Zone 2: Navigation Links */}
        <nav className="hidden md:flex items-center gap-1.5 p-1 bg-[#1c1c23] border border-[#2d2d38] rounded-xl text-sm font-medium">
          <button
            onClick={() => onTabChange('all')}
            className={`px-3.5 py-1.5 rounded-lg transition-all whitespace-nowrap shrink-0 ${
              activeTab === 'all'
                ? 'bg-blue-600 text-white shadow-sm font-semibold'
                : 'text-neutral-400 hover:text-white hover:bg-white/5'
            }`}
          >
            All Models
          </button>
          <button
            onClick={() => onTabChange('mine')}
            className={`px-3.5 py-1.5 rounded-lg transition-all whitespace-nowrap shrink-0 ${
              activeTab === 'mine'
                ? 'bg-blue-600 text-white shadow-sm font-semibold'
                : 'text-neutral-400 hover:text-white hover:bg-white/5'
            }`}
          >
            My Models
          </button>
          <button
            onClick={() => onTabChange('favorites')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg transition-all whitespace-nowrap shrink-0 ${
              activeTab === 'favorites'
                ? 'bg-blue-600 text-white shadow-sm font-semibold'
                : 'text-neutral-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Heart className="w-3.5 h-3.5 fill-current" />
            Favorites
          </button>
          <button
            onClick={() => onTabChange('collections')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg transition-all whitespace-nowrap shrink-0 ${
              activeTab === 'collections'
                ? 'bg-blue-600 text-white shadow-sm font-semibold'
                : 'text-neutral-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Folder className="w-3.5 h-3.5" />
            Collections
          </button>
        </nav>

        {/* Zone 3: Actions & Account Controls */}
        <div className="flex items-center gap-2.5 shrink-0">
          {user ? (
            <>
              <button
                onClick={onOpenUpload}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-500 shadow-md shadow-blue-600/20 active:scale-98 transition-all whitespace-nowrap shrink-0"
              >
                <Upload className="w-3.5 h-3.5" />
                Upload Model
              </button>

              {user.role === 'admin' && (
                <button
                  onClick={onOpenAdmin}
                  title="Admin Console"
                  className="p-2 text-neutral-400 hover:text-amber-400 hover:bg-[#23232c] border border-transparent hover:border-amber-500/30 rounded-lg transition-all"
                >
                  <Shield className="w-4 h-4" />
                </button>
              )}

              <button
                onClick={onOpenPasswordModal}
                title="Change Password"
                className="p-2 text-neutral-400 hover:text-white hover:bg-[#23232c] border border-transparent hover:border-[#333340] rounded-lg transition-all"
              >
                <Lock className="w-4 h-4" />
              </button>

              <div className="hidden sm:flex items-center gap-2 pl-2 pr-3 py-1 bg-[#1f1f27] border border-[#2f2f3d] rounded-lg text-xs">
                <div className="w-5 h-5 rounded-full bg-blue-600/30 text-blue-400 flex items-center justify-center font-bold text-[10px]">
                  {user.username.charAt(0).toUpperCase()}
                </div>
                <span className="font-medium text-white max-w-[90px] truncate">{user.username}</span>
                <span className="text-[10px] px-1.5 py-0.2 bg-blue-900/60 text-blue-300 rounded font-mono">
                  {user.role}
                </span>
              </div>

              <button
                onClick={onLogout}
                title="Log out"
                className="p-2 text-neutral-400 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 rounded-lg transition-all"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </>
          ) : (
            <button
              onClick={onOpenLogin}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-all whitespace-nowrap shrink-0"
            >
              <UserIcon className="w-3.5 h-3.5" />
              Sign In
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
