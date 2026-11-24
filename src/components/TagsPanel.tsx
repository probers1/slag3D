import React, { useMemo, useState } from 'react';
import { AlertTriangle, Check, Hash, Pencil, Plus, Tag, Trash2, X } from 'lucide-react';
import { TagItem } from '../types';
import { apiFetch } from '../utils/api';

interface TagsPanelProps {
  tags: TagItem[];
  canCreate: boolean;
  isAdmin: boolean;
  onRefresh: () => void | Promise<void>;
  onSelectTag: (name: string) => void;
}

const PALETTE = [
  '#60a5fa', '#34d399', '#fbbf24', '#f472b6',
  '#a78bfa', '#fb7185', '#22d3ee', '#a3e635',
];

const DEFAULT_COLOR = PALETTE[0];
const hexColor = (value?: string) => value || DEFAULT_COLOR;

async function errorMessage(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return data?.error || 'Request failed';
  } catch {
    return 'Request failed';
  }
}

export const TagsPanel: React.FC<TagsPanelProps> = ({
  tags,
  canCreate,
  isAdmin,
  onRefresh,
  onSelectTag,
}) => {
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(DEFAULT_COLOR);
  const [newDescription, setNewDescription] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', color: DEFAULT_COLOR, description: '' });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return tags;
    return tags.filter(
      (tag) => tag.name.includes(needle) || tag.description?.toLowerCase().includes(needle)
    );
  }, [tags, query]);

  const maxCount = Math.max(1, ...tags.map((tag) => tag.count || 0));
  const totalUses = tags.reduce((sum, tag) => sum + (tag.count || 0), 0);

  const beginEdit = (tag: TagItem) => {
    setError(null);
    setDeleteId(null);
    setEditingId(tag.id);
    setDraft({ name: tag.name, color: hexColor(tag.color), description: tag.description || '' });
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName,
          color: newColor,
          description: newDescription,
        }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      setNewName('');
      setNewDescription('');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create tag');
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/tags/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      setEditingId(null);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update tag');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/tags/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await errorMessage(res));
      setDeleteId(null);
      setEditingId(null);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete tag');
    } finally {
      setBusy(false);
    }
  };

  const renderSwatches = (selected: string, onPick: (color: string) => void) => (
    <div className="flex items-center gap-1.5">
      {PALETTE.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onPick(color)}
          title={color}
          aria-label={`Use color ${color}`}
          className={`w-5 h-5 rounded-full border transition-transform hover:scale-110 ${
            selected.toLowerCase() === color
              ? 'border-white scale-110 shadow-[0_0_0_2px_rgba(255,255,255,0.12)]'
              : 'border-transparent'
          }`}
          style={{ backgroundColor: color }}
        />
      ))}
      <input
        type="color"
        value={hexColor(selected)}
        onChange={(e) => onPick(e.target.value)}
        title="Custom color"
        aria-label="Custom color"
        className="w-6 h-6 rounded-full bg-transparent border border-[#3a3a48] cursor-pointer p-0"
      />
    </div>
  );

  return (
    <section className="flex flex-col gap-5">
      <div className="relative overflow-hidden rounded-2xl border border-[#2d2d38] bg-[#191920] px-5 py-6 sm:px-7">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              'repeating-linear-gradient(135deg, transparent 0 14px, #93c5fd 14px 15px)',
          }}
        />
        <div className="relative flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <span className="font-mono text-[10px] tracking-[0.24em] uppercase text-blue-400">
              Vault Index / 02
            </span>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-white font-['Plus_Jakarta_Sans',sans-serif]">
              Tag Registry
            </h1>
            <p className="mt-1 text-xs text-neutral-400 max-w-xl leading-relaxed">
              One shared vocabulary for models and documents. Color and notes are global;
              assignment stays under the control of each item's owner.
            </p>
          </div>
          <div className="flex gap-5 font-mono text-[11px] text-neutral-500 shrink-0">
            <div>
              <div className="text-lg text-white">{tags.length}</div>
              TAGS
            </div>
            <div>
              <div className="text-lg text-white">{totalUses}</div>
              LINKS
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs text-red-300">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-300 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-5 items-start">
        <div className="rounded-2xl border border-[#2d2d38] bg-[#191920] overflow-hidden">
          <div className="flex items-center gap-2 border-b border-[#2a2a35] px-4 py-3">
            <Hash className="w-4 h-4 text-blue-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter the registry..."
              className="flex-1 bg-transparent text-xs text-white placeholder-neutral-600 focus:outline-none"
            />
            <span className="font-mono text-[10px] text-neutral-600">
              {filtered.length}/{tags.length}
            </span>
          </div>

          {filtered.length === 0 ? (
            <div className="px-5 py-12 text-center text-xs text-neutral-500">
              No tags match. Create one with the form on the right.
            </div>
          ) : (
            <div className="divide-y divide-[#262630]">
              {filtered.map((tag, index) => {
                const color = hexColor(tag.color);
                const isEditing = editingId === tag.id;
                const isDeleting = deleteId === tag.id;
                const width = `${Math.round(((tag.count || 0) / maxCount) * 100)}%`;

                return (
                  <div
                    key={tag.id}
                    className="relative px-4 py-3.5 transition-colors hover:bg-white/[0.02]"
                    style={{ borderLeft: `2px solid ${color}` }}
                  >
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 font-mono text-[10px] text-neutral-600 w-5 shrink-0">
                        {String(index + 1).padStart(2, '0')}
                      </span>

                      <div className="min-w-0 flex-1">
                        {isEditing ? (
                          <form onSubmit={handleSave} className="flex flex-col gap-2.5">
                            <input
                              value={draft.name}
                              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                              className="w-full bg-[#121216] border border-[#353545] rounded-md px-2.5 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none"
                              aria-label="Tag name"
                            />
                            {renderSwatches(draft.color, (color) =>
                              setDraft({ ...draft, color })
                            )}
                            <input
                              value={draft.description}
                              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                              placeholder="Short note (optional)"
                              className="w-full bg-[#121216] border border-[#353545] rounded-md px-2.5 py-1.5 text-xs text-white placeholder-neutral-600 focus:border-blue-500 focus:outline-none"
                              aria-label="Tag description"
                            />
                            <div className="flex gap-2">
                              <button
                                type="submit"
                                disabled={busy}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-600 text-white text-[11px] font-semibold disabled:opacity-50"
                              >
                                <Check className="w-3 h-3" /> Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                className="px-2 py-1 text-[11px] text-neutral-400 hover:text-white"
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        ) : isDeleting ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-red-300">
                              Delete #{tag.name}? It will be removed from {tag.count} item
                              {tag.count === 1 ? '' : 's'}.
                            </span>
                            <button
                              onClick={() => handleDelete(tag.id)}
                              disabled={busy}
                              className="px-2 py-1 rounded-md bg-red-600/80 text-white text-[11px] font-semibold disabled:opacity-50"
                            >
                              Delete
                            </button>
                            <button
                              onClick={() => setDeleteId(null)}
                              className="px-2 py-1 text-[11px] text-neutral-400 hover:text-white"
                            >
                              Keep
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              onClick={() => onSelectTag(tag.name)}
                              className="group/tag flex items-center gap-2 text-left"
                              title={`Filter vault by #${tag.name}`}
                            >
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: color }}
                              />
                              <span className="text-sm font-semibold text-neutral-100 group-hover/tag:text-blue-300 transition-colors">
                                #{tag.name}
                              </span>
                            </button>
                            {tag.description && (
                              <p className="mt-1 text-[11px] text-neutral-500 leading-relaxed">
                                {tag.description}
                              </p>
                            )}
                            <div className="mt-2 h-0.5 w-full max-w-[220px] rounded-full bg-[#25252f]">
                              <div
                                className="h-full rounded-full"
                                style={{ backgroundColor: color, width }}
                              />
                            </div>
                          </>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono text-[11px] text-neutral-500">
                          {tag.count.toString().padStart(2, '0')}
                        </span>
                        {isAdmin && !isEditing && !isDeleting && (
                          <div className="flex gap-1">
                            <button
                              onClick={() => beginEdit(tag)}
                              title={`Edit #${tag.name}`}
                              className="p-1.5 rounded-md text-neutral-500 hover:text-blue-300 hover:bg-blue-500/10 transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                setError(null);
                                setEditingId(null);
                                setDeleteId(tag.id);
                              }}
                              title={`Delete #${tag.name}`}
                              className="p-1.5 rounded-md text-neutral-500 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {canCreate ? (
          <form
            onSubmit={handleCreate}
            className="rounded-2xl border border-[#2d2d38] bg-[#1b1b23] p-5 flex flex-col gap-4"
          >
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-300">
                <Plus className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-white">New tag</h2>
                <p className="text-[10px] text-neutral-500">Available to every vault user.</p>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="new-tag-name" className="text-[10px] uppercase tracking-wider text-neutral-500">
                Name
              </label>
              <input
                id="new-tag-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. benchy"
                maxLength={40}
                required
                className="w-full bg-[#121216] border border-[#343444] rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-[10px] uppercase tracking-wider text-neutral-500">Color</span>
              {renderSwatches(newColor, setNewColor)}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="new-tag-description" className="text-[10px] uppercase tracking-wider text-neutral-500">
                Note
              </label>
              <textarea
                id="new-tag-description"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={3}
                maxLength={200}
                placeholder="Optional context for other users"
                className="w-full bg-[#121216] border border-[#343444] rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-blue-500 resize-none"
              />
            </div>

            <button
              type="submit"
              disabled={busy || !newName.trim()}
              className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/15 disabled:opacity-40 disabled:shadow-none transition-all"
            >
              <Tag className="w-3.5 h-3.5" />
              Add to registry
            </button>

            {!isAdmin && (
              <p className="text-[10px] text-neutral-600 leading-relaxed">
                You can create and assign tags. Renaming, recoloring and deletion are reserved for admins.
              </p>
            )}
          </form>
        ) : (
          <div className="rounded-2xl border border-[#2d2d38] bg-[#1b1b23] p-5 text-xs text-neutral-500 leading-relaxed">
            The registry is read-only until you log in. Logged-in users can create and assign tags;
            admins can rename, recolor and delete them.
          </div>
        )}
      </div>
    </section>
  );
};
