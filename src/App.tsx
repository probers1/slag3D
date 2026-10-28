import React, { useState, useEffect, useCallback } from 'react';
import { Search, Filter, RefreshCw, X, Folder, Upload, ChevronLeft, ChevronRight, Layers, Tag } from 'lucide-react';
import { User, ModelItem, CollectionItem, TagItem } from './types';
import { Navbar } from './components/Navbar';
import { ModelCard } from './components/ModelCard';
import { CollectionsDrawer } from './components/CollectionsDrawer';
import { UploadModal } from './components/UploadModal';
import { AdminModal } from './components/AdminModal';
import { ChangePasswordModal } from './components/ChangePasswordModal';
import { LoginModal } from './components/LoginModal';
import { ModelViewerModal } from './components/ModelViewerModal';
import { apiFetch, getStoredToken, setStoredToken, setStoredUser } from './utils/api';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Filter and pagination state
  const [activeTab, setActiveTab] = useState<'all' | 'mine' | 'favorites' | 'collections'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(12);

  // Data state
  const [models, setModels] = useState<ModelItem[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 12, totalPages: 1 });
  const [tags, setTags] = useState<TagItem[]>([]);
  const [collections, setCollections] = useState<CollectionItem[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  // Modals state
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  // Check auth status on mount
  const checkAuth = async () => {
    try {
      const res = await apiFetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          setCurrentUser(data.user);
          setStoredUser(data.user);
          setAuthChecked(true);
          return;
        }
      }
    } catch (err) {
      console.warn('[SLAG3D] Auth check failed, showing login prompt:', err);
    }

    // Set authenticated state as false if no valid session found
    setAuthChecked(true); // Mark auth check complete so we render the proper UI
  };

  useEffect(() => {
    checkAuth();
  }, []);

  // Fetch Collections list
  const fetchCollections = useCallback(async () => {
    if (!currentUser) return;
    try {
      const res = await apiFetch('/api/collections');
      if (res.ok) {
        const data = await res.json();
        setCollections(data.collections || []);
      }
    } catch (err) {
      console.error('Error fetching collections:', err);
    }
  }, [currentUser]);

  // Fetch Tags list
  const fetchTags = useCallback(async () => {
    try {
      const res = await apiFetch('/api/tags');
      if (res.ok) {
        const data = await res.json();
        setTags(data.tags || []);
      }
    } catch (err) {
      console.error('Error fetching tags:', err);
    }
  }, []);

  // Fetch Models with filters
  const fetchModels = useCallback(async () => {
    if (!currentUser) return;
    setLoadingModels(true);
    try {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: itemsPerPage.toString(),
        filter: activeTab === 'collections' ? 'all' : activeTab,
      });

      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      if (selectedTag) params.set('tag', selectedTag);
      if (selectedCollectionId) params.set('collection_id', selectedCollectionId);

      const res = await apiFetch(`/api/models?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setModels(data.models || []);
        setPagination(data.pagination || { total: 0, page: 1, limit: itemsPerPage, totalPages: 1 });
      } else if (res.status === 401) {
        // Re-check auth if session dropped
        checkAuth();
      }
    } catch (err) {
      console.error('Error fetching models:', err);
    } finally {
      setLoadingModels(false);
    }
  }, [currentUser, activeTab, searchQuery, selectedTag, selectedCollectionId, currentPage, itemsPerPage]);

  useEffect(() => {
    if (currentUser) {
      fetchCollections();
      fetchTags();
      fetchModels();
    }
  }, [currentUser, fetchCollections, fetchTags, fetchModels]);

  // Tab change handler
  const handleTabChange = (tab: 'all' | 'mine' | 'favorites' | 'collections') => {
    setActiveTab(tab);
    setCurrentPage(1);
    if (tab !== 'collections') {
      setSelectedCollectionId(null);
    }
  };

  // Toggle favorite
  const handleToggleFavorite = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await apiFetch(`/api/models/${id}/favorite`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setModels((prev) =>
          prev.map((m) => (m.id === id ? { ...m, is_favorited: data.is_favorited } : m))
        );
      }
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
    }
  };

  // Retry thumbnail render
  const handleRetryThumbnail = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await apiFetch(`/api/models/${id}/regenerate-thumbnail`, { method: 'POST' });
      if (res.ok) {
        setModels((prev) =>
          prev.map((m) => (m.id === id ? { ...m, thumbnail_status: 'pending' } : m))
        );
      }
    } catch (err) {
      console.error('Failed to trigger re-render:', err);
    }
  };

  // Logout handler
  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
      setStoredToken(null);
      setStoredUser(null);
      setCurrentUser(null);
      setModels([]);
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  // Collection CRUD handlers
  const handleCreateCollection = async (name: string, description: string, parentId: string | null) => {
    try {
      const res = await apiFetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, parent_folder_id: parentId }),
      });
      if (res.ok) {
        fetchCollections();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to create collection');
      }
    } catch (err) {
      console.error('Create collection error:', err);
    }
  };

  const handleRenameCollection = async (id: string, name: string) => {
    try {
      const res = await apiFetch(`/api/collections/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        fetchCollections();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to rename collection');
      }
    } catch (err) {
      console.error('Rename collection error:', err);
    }
  };

  const handleDeleteCollection = async (id: string) => {
    try {
      const res = await apiFetch(`/api/collections/${id}`, { method: 'DELETE' });
      if (res.ok) {
        if (selectedCollectionId === id) setSelectedCollectionId(null);
        fetchCollections();
      }
    } catch (err) {
      console.error('Delete collection error:', err);
    }
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#121214] flex items-center justify-center text-neutral-400">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#121214] text-neutral-100 flex flex-col font-['DM_Sans',sans-serif] selection:bg-blue-600 selection:text-white">
      {/* Top Navigation Bar */}
      <Navbar
        user={currentUser}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onOpenUpload={() => setIsUploadOpen(true)}
        onOpenAdmin={() => setIsAdminOpen(true)}
        onOpenPasswordModal={() => setIsPasswordModalOpen(true)}
        onLogout={handleLogout}
        onOpenLogin={() => setIsLoginOpen(true)}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 lg:px-8 py-6 flex flex-col gap-6">
        {!currentUser ? (
          <div className="my-auto py-16 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-2xl bg-blue-600/15 border border-blue-500/30 flex items-center justify-center text-blue-400 mb-4">
              <Layers className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2 font-['Plus_Jakarta_Sans',sans-serif]">
              Welcome to SLAG3D
            </h1>
            <p className="text-sm text-neutral-400 max-w-md mb-6">
              Your self-hosted 3D printer asset vault with automated 512×512 headless renders, slicing mesh analytics, and hierarchical collections.
            </p>
            <button
              onClick={() => setIsLoginOpen(true)}
              className="px-6 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-xl shadow-lg shadow-blue-600/25 transition-all"
            >
              Sign In to Access Vault
            </button>
          </div>
        ) : (
          <>
            {/* Top Filter and Search Bar */}
            <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 bg-[#191920] border border-[#292934] p-3 rounded-2xl">
              {/* Search input */}
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-neutral-500 absolute left-3.5 top-3" />
                <input
                  type="text"
                  placeholder="Search 3D models by title or description..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-full bg-[#121214] border border-[#2e2e3c] rounded-xl pl-9 pr-8 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-blue-500 transition-colors"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-2.5 text-neutral-500 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Tag and Collection filter badges */}
              <div className="flex items-center gap-2 flex-wrap">
                {selectedCollectionId && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-950/60 border border-blue-800/60 text-blue-300 rounded-lg text-xs">
                    <Folder className="w-3.5 h-3.5 text-blue-400" />
                    <span>
                      Folder: {collections.find((c) => c.id === selectedCollectionId)?.name || 'Custom'}
                    </span>
                    <button
                      onClick={() => setSelectedCollectionId(null)}
                      className="ml-1 text-blue-400 hover:text-white"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}

                {selectedTag && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-950/60 border border-blue-800/60 text-blue-300 rounded-lg text-xs">
                    <Tag className="w-3.5 h-3.5 text-blue-400" />
                    <span>#{selectedTag}</span>
                    <button
                      onClick={() => setSelectedTag(null)}
                      className="ml-1 text-blue-400 hover:text-white"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}

                {/* Items per page selector */}
                <div className="flex items-center gap-1.5 text-xs text-neutral-400 pl-2">
                  <span className="hidden sm:inline">Per page:</span>
                  <select
                    value={itemsPerPage}
                    onChange={(e) => {
                      setItemsPerPage(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    className="bg-[#121214] border border-[#2e2e3c] rounded-lg px-2 py-1 text-xs text-neutral-200 outline-none"
                  >
                    <option value={6}>6</option>
                    <option value={12}>12</option>
                    <option value={24}>24</option>
                    <option value={48}>48</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Popular Tags strip */}
            {tags.length > 0 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
                <span className="text-neutral-500 text-[11px] font-medium shrink-0 flex items-center gap-1">
                  <Tag className="w-3 h-3" /> Tags:
                </span>
                <button
                  onClick={() => setSelectedTag(null)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors shrink-0 ${
                    selectedTag === null
                      ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40'
                      : 'text-neutral-400 hover:text-white hover:bg-[#1e1e26]'
                  }`}
                >
                  All
                </button>
                {tags.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setSelectedTag(selectedTag === t.name ? null : t.name);
                      setCurrentPage(1);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs transition-colors shrink-0 flex items-center gap-1.5 ${
                      selectedTag === t.name
                        ? 'bg-blue-600 text-white font-medium shadow-sm'
                        : 'bg-[#1a1a22] text-neutral-400 hover:text-white hover:bg-[#22222c] border border-[#282834]'
                    }`}
                  >
                    <span>#{t.name}</span>
                    <span className="text-[10px] text-neutral-500 font-mono">({t.count})</span>
                  </button>
                ))}
              </div>
            )}

            {/* Dashboard 2-Column Split: Collections on Left (if collections tab or user wants), Grid on Right */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
              {/* Left Column: Collections Hierarchy */}
              <div className="lg:col-span-1">
                <CollectionsDrawer
                  collections={collections}
                  selectedCollectionId={selectedCollectionId}
                  onSelectCollection={(id) => {
                    setSelectedCollectionId(id);
                    setCurrentPage(1);
                  }}
                  onCreateCollection={handleCreateCollection}
                  onRenameCollection={handleRenameCollection}
                  onDeleteCollection={handleDeleteCollection}
                  onClose={() => {}}
                />
              </div>

              {/* Right Column: Model Card Grid */}
              <div className="lg:col-span-3 flex flex-col gap-4">
                {/* Header status count */}
                <div className="flex items-center justify-between text-xs text-neutral-400 px-1">
                  <span>
                    Showing <strong className="text-white font-mono">{models.length}</strong> of{' '}
                    <strong className="text-white font-mono">{pagination.total}</strong> assets
                  </span>
                  {loadingModels && (
                    <span className="flex items-center gap-1.5 text-blue-400">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Loading vault assets...
                    </span>
                  )}
                </div>

                {models.length === 0 && !loadingModels ? (
                  <div className="bg-[#18181e] border border-[#2b2b36] rounded-2xl p-12 text-center flex flex-col items-center justify-center">
                    <div className="w-14 h-14 rounded-2xl bg-[#23232c] flex items-center justify-center text-neutral-500 mb-3">
                      <Layers className="w-7 h-7" />
                    </div>
                    <h3 className="text-base font-bold text-white mb-1">No 3D Models Found</h3>
                    <p className="text-xs text-neutral-400 max-w-sm mb-4">
                      {searchQuery || selectedTag || selectedCollectionId
                        ? 'No assets matched your search filters. Try clearing your filters.'
                        : 'Your vault is currently empty. Upload your first .STL, .3MF, or .OBJ asset!'}
                    </p>
                    <button
                      onClick={() => setIsUploadOpen(true)}
                      className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg shadow-md transition-all"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Upload First Model
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    {models.map((m) => (
                      <ModelCard
                        key={m.id}
                        model={m}
                        onSelect={(id) => setSelectedModelId(id)}
                        onToggleFavorite={handleToggleFavorite}
                        onRetryThumbnail={handleRetryThumbnail}
                        onThumbnailUpdated={(id, thumb) => {
                          setModels((prev) =>
                            prev.map((item) =>
                              item.id === id ? { ...item, thumbnail_path: thumb, thumbnail_status: 'completed' } : item
                            )
                          );
                        }}
                      />
                    ))}
                  </div>
                )}

                {/* Pagination Controls */}
                {pagination.totalPages > 1 && (
                  <div className="flex items-center justify-between pt-4 border-t border-[#252530] text-xs">
                    <button
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage <= 1}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#30303e] text-neutral-300 hover:text-white hover:bg-[#202028] disabled:opacity-40 transition-colors"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      Previous
                    </button>

                    <div className="flex items-center gap-1">
                      {Array.from({ length: pagination.totalPages }, (_, i) => i + 1).map((p) => (
                        <button
                          key={p}
                          onClick={() => setCurrentPage(p)}
                          className={`w-7 h-7 rounded-lg text-xs font-mono font-medium transition-colors ${
                            p === currentPage
                              ? 'bg-blue-600 text-white font-bold'
                              : 'text-neutral-400 hover:text-white hover:bg-[#202028]'
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>

                    <button
                      onClick={() => setCurrentPage((p) => Math.min(pagination.totalPages, p + 1))}
                      disabled={currentPage >= pagination.totalPages}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#30303e] text-neutral-300 hover:text-white hover:bg-[#202028] disabled:opacity-40 transition-colors"
                    >
                      Next
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </main>

      {/* Upload Modal */}
      {isUploadOpen && (
        <UploadModal
          collections={collections}
          onClose={() => setIsUploadOpen(false)}
          onUploadSuccess={() => {
            fetchModels();
            fetchTags();
            fetchCollections();
          }}
        />
      )}

      {/* Admin Panel Modal */}
      {isAdminOpen && currentUser && (
        <AdminModal
          currentUserId={currentUser.id}
          onClose={() => setIsAdminOpen(false)}
        />
      )}

      {/* Change Password Modal */}
      {isPasswordModalOpen && (
        <ChangePasswordModal onClose={() => setIsPasswordModalOpen(false)} />
      )}

      {/* Sign In Modal */}
      {isLoginOpen && (
        <LoginModal
          onLoginSuccess={(user) => {
            setCurrentUser(user);
            setIsLoginOpen(false);
          }}
          onClose={() => setIsLoginOpen(false)}
        />
      )}

      {/* 3D Model Viewer Modal */}
      {selectedModelId && (
        <ModelViewerModal
          modelId={selectedModelId}
          collections={collections}
          currentUserId={currentUser?.id}
          isAdmin={currentUser?.role === 'admin'}
          onClose={() => setSelectedModelId(null)}
          onModelUpdated={() => {
            fetchModels();
            fetchTags();
            fetchCollections();
          }}
        />
      )}
    </div>
  );
}
