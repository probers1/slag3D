import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../utils/api';
import { ModelItem, TagItem, CollectionItem, User } from '../types';

/*
 * useVaultData custom hook:
 * Centralizes all logic for fetching, filtering, and paginating model data.
 * This hook ensures that the component using it (App.tsx) only needs to
 * react to changes in the primary filter states, keeping App.tsx clean.
 */
export const useVaultData = (
  currentUser: User | null,
  activeTab: 'all' | 'mine' | 'favorites' | 'collections',
  searchQuery: string,
  selectedTag: string | null,
  selectedCollectionId: string | null,
  currentPage: number,
  itemsPerPage: number
) => {
  const [models, setModels] = useState<ModelItem[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 12, totalPages: 1 });
  const [loadingModels, setLoadingModels] = useState(false);

  // The core fetching mechanism, encapsulated
  const fetchModels = useCallback(async () => {
    if (!currentUser) {
      setModels([]);
      setPagination({ total: 0, page: 1, limit: itemsPerPage, totalPages: 1 });
      return;
    }

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
        console.warn('[SLAG3D] Model fetch returned 401 - session may have expired');
        // Real implementation might need a way to trigger re-auth here
      }
    } catch (err) {
      console.error('Error fetching models:', err);
    } finally {
      setLoadingModels(false);
    }
  }, [currentUser, activeTab, searchQuery, selectedTag, selectedCollectionId, currentPage, itemsPerPage]);


  // Effect to run the fetch whenever dependencies change
  useEffect(() => {
    fetchModels();
  }, [fetchModels]); // fetchModels is memoized, so this effect runs on changes to its dependencies.

  // Return the state and controls
  return {
    models,
    pagination,
    loadingModels,
    refetchModels: fetchModels, // Expose the function to manually re-run fetch
  };
};