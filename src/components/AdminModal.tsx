import React, { useState, useEffect } from 'react';
import { Shield, UserPlus, Key, Trash2, X, AlertCircle, Check } from 'lucide-react';
import { User } from '../types';
import { apiFetch } from '../utils/api';

interface AdminModalProps {
  currentUserId: string;
  onClose: () => void;
}

export const AdminModal: React.FC<AdminModalProps> = ({ currentUserId, onClose }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form states
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user');

  // Reset password states
  const [resetTargetId, setResetTargetId] = useState<string | null>(null);
  const [resetPasswordVal, setResetPasswordVal] = useState('');

  const fetchUsers = async () => {
    try {
      const res = await apiFetch('/api/admin/users');
      if (!res.ok) throw new Error('Failed to load user list');
      const data = await res.json();
      setUsers(data.users || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      const res = await apiFetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          role: newRole,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create user');

      setSuccess(`User "${newUsername}" created successfully`);
      setNewUsername('');
      setNewPassword('');
      setNewRole('user');
      fetchUsers();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleResetPassword = async (id: string) => {
    if (!resetPasswordVal.trim()) return;
    setError(null);
    setSuccess(null);
    try {
      const res = await apiFetch(`/api/admin/users/${id}/reset-password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: resetPasswordVal }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reset password');

      setSuccess('Password reset successfully');
      setResetTargetId(null);
      setResetPasswordVal('');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteUser = async (id: string, username: string) => {
    if (!confirm(`Are you sure you want to delete user "${username}"?`)) return;
    setError(null);
    setSuccess(null);
    try {
      const res = await apiFetch(`/api/admin/users/${id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete user');

      setSuccess(`User "${username}" deleted`);
      fetchUsers();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-[#18181e] border border-[#2d2d38] rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#262632]">
          <div className="flex items-center gap-2.5">
            <Shield className="w-5 h-5 text-amber-400" />
            <h2 className="text-base font-bold text-white">Administrator Control Panel</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-neutral-400 hover:text-white rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Feedback banners */}
        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-950/40 border border-red-800/60 rounded-xl text-xs text-red-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="mx-6 mt-4 p-3 bg-emerald-950/40 border border-emerald-800/60 rounded-xl text-xs text-emerald-300 flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{success}</span>
          </div>
        )}

        <div className="p-6 flex flex-col gap-6">
          {/* Create User Section */}
          <div className="bg-[#202028] border border-[#2e2e3a] rounded-xl p-4">
            <h3 className="text-xs font-bold text-white flex items-center gap-2 mb-3">
              <UserPlus className="w-4 h-4 text-blue-400" />
              Provision New User Account
            </h3>
            <form onSubmit={handleCreateUser} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <input
                type="text"
                placeholder="Username (e.g. maker2)"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                required
                className="bg-[#141417] border border-[#383846] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
              />
              <input
                type="password"
                placeholder="Temporary Password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                className="bg-[#141417] border border-[#383846] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
              />
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as 'user' | 'admin')}
                className="bg-[#141417] border border-[#383846] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
              >
                <option value="user">User (Standard)</option>
                <option value="admin">Administrator</option>
              </select>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
              >
                Create Account
              </button>
            </form>
          </div>

          {/* User Accounts Table */}
          <div>
            <h3 className="text-xs font-bold text-neutral-300 mb-2">Registered Accounts ({users.length})</h3>
            <div className="border border-[#2a2a36] rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#1c1c24] text-neutral-400 font-semibold border-b border-[#2a2a36]">
                  <tr>
                    <th className="py-2.5 px-4">Username</th>
                    <th className="py-2.5 px-4">Role</th>
                    <th className="py-2.5 px-4">Created Date</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#242430]">
                  {loading ? (
                    <tr>
                      <td colSpan={4} className="py-4 text-center text-neutral-500">
                        Loading accounts...
                      </td>
                    </tr>
                  ) : users.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-4 text-center text-neutral-500">
                        No users registered.
                      </td>
                    </tr>
                  ) : (
                    users.map((u) => (
                      <tr key={u.id} className="hover:bg-[#1f1f27] transition-colors">
                        <td className="py-3 px-4 font-medium text-white flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-blue-600/20 text-blue-400 flex items-center justify-center font-bold text-[10px]">
                            {u.username.charAt(0).toUpperCase()}
                          </span>
                          <span>{u.username}</span>
                          {u.id === currentUserId && (
                            <span className="text-[10px] text-neutral-500 font-mono">(You)</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${
                              u.role === 'admin'
                                ? 'bg-amber-950/60 text-amber-300 border border-amber-800/50'
                                : 'bg-[#252530] text-neutral-300'
                            }`}
                          >
                            {u.role}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-neutral-400 font-mono text-[11px]">
                          {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {resetTargetId === u.id ? (
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="password"
                                  placeholder="New password"
                                  value={resetPasswordVal}
                                  onChange={(e) => setResetPasswordVal(e.target.value)}
                                  className="bg-[#121214] border border-amber-500 rounded px-2 py-1 text-white text-xs outline-none w-32"
                                  autoFocus
                                />
                                <button
                                  onClick={() => handleResetPassword(u.id)}
                                  className="px-2 py-1 bg-amber-600 text-white rounded text-[10px] font-medium"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => {
                                    setResetTargetId(null);
                                    setResetPasswordVal('');
                                  }}
                                  className="px-2 py-1 text-neutral-400 text-[10px]"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => {
                                  setResetTargetId(u.id);
                                  setResetPasswordVal('');
                                }}
                                title="Reset user password"
                                className="p-1.5 text-neutral-400 hover:text-amber-400 hover:bg-black/30 rounded transition-colors"
                              >
                                <Key className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {u.id !== currentUserId && (
                              <button
                                onClick={() => handleDeleteUser(u.id, u.username)}
                                title="Delete user"
                                className="p-1.5 text-neutral-400 hover:text-red-400 hover:bg-black/30 rounded transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
