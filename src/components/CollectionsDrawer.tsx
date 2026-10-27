import React, { useState } from 'react';
import { Folder, FolderPlus, ChevronRight, ChevronDown, Trash2, Edit2, X, Plus } from 'lucide-react';
import { CollectionItem } from '../types';

interface CollectionsDrawerProps {
  collections: CollectionItem[];
  selectedCollectionId: string | null;
  onSelectCollection: (id: string | null) => void;
  onCreateCollection: (name: string, description: string, parentId: string | null) => Promise<void>;
  onRenameCollection: (id: string, name: string) => Promise<void>;
  onDeleteCollection: (id: string) => Promise<void>;
  onClose: () => void;
}

export const CollectionsDrawer: React.FC<CollectionsDrawerProps> = ({
  collections,
  selectedCollectionId,
  onSelectCollection,
  onCreateCollection,
  onRenameCollection,
  onDeleteCollection,
  onClose,
}) => {
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [isCreating, setIsCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderDesc, setNewFolderDesc] = useState('');
  const [parentTargetId, setParentTargetId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  // Build tree from flat list using parent_folder_id
  const rootCollections = collections.filter((c) => !c.parent_folder_id);
  const getChildren = (parentId: string) => collections.filter((c) => c.parent_folder_id === parentId);

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedFolders((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    await onCreateCollection(newFolderName.trim(), newFolderDesc.trim(), parentTargetId);
    setNewFolderName('');
    setNewFolderDesc('');
    setIsCreating(false);
    setParentTargetId(null);
  };

  const handleRenameSubmit = async (id: string) => {
    if (!editName.trim()) return;
    await onRenameCollection(id, editName.trim());
    setEditingId(null);
  };

  const renderFolderItem = (item: CollectionItem, depth: number = 0) => {
    const children = getChildren(item.id);
    const hasChildren = children.length > 0;
    const isExpanded = !!expandedFolders[item.id];
    const isSelected = selectedCollectionId === item.id;

    return (
      <div key={item.id} className="flex flex-col">
        <div
          onClick={() => onSelectCollection(item.id)}
          style={{ paddingLeft: `${depth * 16 + 12}px` }}
          className={`flex items-center justify-between py-2 pr-3 rounded-lg text-xs cursor-pointer group transition-colors ${
            isSelected
              ? 'bg-blue-600/20 text-blue-400 font-semibold border border-blue-500/30'
              : 'text-neutral-300 hover:bg-[#23232c] hover:text-white'
          }`}
        >
          <div className="flex items-center gap-2 truncate">
            {hasChildren ? (
              <button
                onClick={(e) => toggleExpand(item.id, e)}
                className="p-0.5 text-neutral-400 hover:text-white"
              >
                {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
            ) : (
              <span className="w-3.5" />
            )}

            <Folder className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-blue-400' : 'text-neutral-400'}`} />

            {editingId === item.id ? (
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={() => handleRenameSubmit(item.id)}
                onKeyDown={(e) => e.key === 'Enter' && handleRenameSubmit(item.id)}
                autoFocus
                className="bg-[#121214] border border-blue-500 rounded px-1.5 py-0.5 text-white text-xs outline-none"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="truncate">{item.name}</span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0 opacity-80 group-hover:opacity-100">
            <span className="text-[10px] font-mono text-neutral-500 px-1.5 py-0.2 bg-[#17171d] rounded">
              {item.model_count}
            </span>

            <button
              onClick={(e) => {
                e.stopPropagation();
                setParentTargetId(item.id);
                setIsCreating(true);
              }}
              title="Add subfolder"
              className="p-1 text-neutral-500 hover:text-blue-400 rounded hover:bg-black/40 transition-colors"
            >
              <Plus className="w-3 h-3" />
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditingId(item.id);
                setEditName(item.name);
              }}
              title="Rename folder"
              className="p-1 text-neutral-500 hover:text-amber-400 rounded hover:bg-black/40 transition-colors"
            >
              <Edit2 className="w-3 h-3" />
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete collection "${item.name}"?`)) {
                  onDeleteCollection(item.id);
                }
              }}
              title="Delete folder"
              className="p-1 text-neutral-500 hover:text-red-400 rounded hover:bg-black/40 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>

        {hasChildren && isExpanded && (
          <div className="flex flex-col mt-0.5">
            {children.map((child) => renderFolderItem(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="bg-[#18181e] border border-[#2b2b36] rounded-2xl p-4 flex flex-col gap-3 shadow-lg">
      <div className="flex items-center justify-between pb-3 border-b border-[#282834]">
        <div className="flex items-center gap-2 text-neutral-200 font-semibold text-sm">
          <Folder className="w-4 h-4 text-blue-400" />
          <span>Collections & Folders</span>
        </div>
        <button
          onClick={() => {
            setParentTargetId(null);
            setIsCreating(true);
          }}
          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
        >
          <FolderPlus className="w-3.5 h-3.5" />
          New Folder
        </button>
      </div>

      {isCreating && (
        <form onSubmit={handleCreateSubmit} className="bg-[#202028] p-3 rounded-xl border border-[#323240] flex flex-col gap-2">
          <div className="text-xs font-semibold text-neutral-300">
            {parentTargetId ? 'Create Nested Subfolder' : 'Create New Collection'}
          </div>
          <input
            type="text"
            placeholder="Folder Name (e.g. Mechanical Gears)"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            required
            autoFocus
            className="w-full bg-[#141417] border border-[#3a3a48] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
          />
          <input
            type="text"
            placeholder="Optional Description"
            value={newFolderDesc}
            onChange={(e) => setNewFolderDesc(e.target.value)}
            className="w-full bg-[#141417] border border-[#3a3a48] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
          />
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setIsCreating(false);
                setParentTargetId(null);
              }}
              className="px-2.5 py-1 text-xs text-neutral-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-3 py-1 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg"
            >
              Save Folder
            </button>
          </div>
        </form>
      )}

      {/* All Models Default Filter Reset */}
      <div
        onClick={() => onSelectCollection(null)}
        className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs cursor-pointer transition-colors ${
          selectedCollectionId === null
            ? 'bg-blue-600/20 text-blue-400 font-semibold border border-blue-500/30'
            : 'text-neutral-300 hover:bg-[#23232c] hover:text-white'
        }`}
      >
        <span className="flex items-center gap-2">
          <Folder className="w-3.5 h-3.5" />
          <span>All Collections (Vault Root)</span>
        </span>
      </div>

      {/* Tree Hierarchy */}
      <div className="flex flex-col gap-1 max-h-[350px] overflow-y-auto pr-1">
        {rootCollections.length === 0 ? (
          <div className="py-6 text-center text-xs text-neutral-500">
            No custom collections created yet.
          </div>
        ) : (
          rootCollections.map((col) => renderFolderItem(col, 0))
        )}
      </div>
    </div>
  );
};
