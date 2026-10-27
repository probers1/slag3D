import React, { useEffect } from 'react';
import { Heart, RefreshCw, Layers, Box } from 'lucide-react';
import { ModelItem } from '../types';
import { renderThumbnailInBrowser } from '../utils/clientThumbnailRenderer';

interface ModelCardProps {
  model: ModelItem;
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string, e: React.MouseEvent) => void;
  onRetryThumbnail: (id: string, e: React.MouseEvent) => void;
  onThumbnailUpdated?: (modelId: string, thumbnailPath: string) => void;
}

export const ModelCard: React.FC<ModelCardProps> = ({
  model,
  onSelect,
  onToggleFavorite,
  onRetryThumbnail,
  onThumbnailUpdated,
}) => {
  const primaryExt = model.primary_file
    ? model.primary_file.original_name.split('.').pop()?.toUpperCase()
    : '3D';

  // Automatically attempt client-side WebGL capture fallback if thumbnail is pending or failed
  useEffect(() => {
    if (model.thumbnail_status !== 'completed' && model.primary_file?.file_path) {
      renderThumbnailInBrowser(model.id, model.primary_file.file_path, (newThumb) => {
        if (onThumbnailUpdated) {
          onThumbnailUpdated(model.id, newThumb);
        }
      });
    }
  }, [model.id, model.thumbnail_status, model.primary_file?.file_path]);

  return (
    <div
      onClick={() => onSelect(model.id)}
      className="group bg-[#1a1a20] hover:bg-[#1f1f26] border border-[#2a2a35] hover:border-blue-500/50 rounded-xl overflow-hidden transition-all duration-200 cursor-pointer flex flex-col shadow-sm hover:shadow-lg hover:shadow-blue-950/20"
    >
      {/* 512x512 Thumbnail Stage (Square aspect ratio) */}
      <div className="relative aspect-square w-full bg-[#121214] flex items-center justify-center overflow-hidden border-b border-[#252530]">
        {model.thumbnail_status === 'completed' && model.thumbnail_path ? (
          <img
            src={model.thumbnail_path}
            alt={model.title}
            className="w-full h-full object-contain p-2 group-hover:scale-[1.03] transition-transform duration-300"
            loading="lazy"
            onError={(e) => {
              // Graceful fallback if image file fails to load
              (e.currentTarget as HTMLElement).style.display = 'none';
            }}
          />
        ) : model.thumbnail_status === 'processing' || model.thumbnail_status === 'pending' ? (
          <div className="flex flex-col items-center justify-center p-6 text-center">
            <RefreshCw className="w-8 h-8 text-blue-400 animate-spin mb-2.5 opacity-80" />
            <span className="text-xs font-medium text-neutral-300">
              {model.thumbnail_status === 'processing' ? 'Rendering 512px view...' : 'Queued in render queue...'}
            </span>
            <span className="text-[10px] text-neutral-500 mt-1">Headless Chromium worker</span>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center p-6 text-center">
            <Box className="w-8 h-8 text-neutral-600 mb-2" />
            <span className="text-xs text-neutral-400 mb-2">Thumbnail generation pending</span>
            <button
              onClick={(e) => onRetryThumbnail(model.id, e)}
              className="px-2.5 py-1 text-[11px] font-medium text-blue-400 bg-blue-950/60 hover:bg-blue-900 border border-blue-800/60 rounded flex items-center gap-1 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Retry Render
            </button>
          </div>
        )}

        {/* Primary Format Badge */}
        <div className="absolute top-2.5 left-2.5 px-2 py-0.5 bg-black/60 backdrop-blur-sm border border-white/10 rounded text-[10px] font-mono font-semibold text-neutral-200">
          {primaryExt}
        </div>

        {/* Favorite Heart Button */}
        <button
          onClick={(e) => onToggleFavorite(model.id, e)}
          title={model.is_favorited ? 'Remove from favorites' : 'Add to favorites'}
          className={`absolute top-2.5 right-2.5 p-2 rounded-lg backdrop-blur-md transition-all ${
            model.is_favorited
              ? 'bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/30'
              : 'bg-black/50 text-neutral-400 border border-white/10 hover:text-white hover:bg-black/70'
          }`}
        >
          <Heart className={`w-4 h-4 ${model.is_favorited ? 'fill-current text-red-500' : ''}`} />
        </button>
      </div>

      {/* Card Body */}
      <div className="p-3.5 flex flex-col flex-1 justify-between">
        <div>
          <h3 className="font-semibold text-sm text-neutral-100 group-hover:text-blue-400 transition-colors line-clamp-1 mb-1">
            {model.title}
          </h3>

          {/* Unboxed Metadata with Typographic Separator */}
          <div className="flex items-center gap-1.5 text-xs text-neutral-400 mb-2.5">
            <span>by {model.owner_username}</span>
            <span aria-hidden="true">·</span>
            <span className="flex items-center gap-1 font-mono text-[11px]">
              <Layers className="w-3 h-3 text-neutral-500" />
              {model.files_count} {model.files_count === 1 ? 'file' : 'files'}
            </span>
          </div>
        </div>

        {/* Tag chips */}
        {model.tags && model.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-auto">
            {model.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="text-[10px] font-medium px-1.5 py-0.5 bg-[#23232c] text-neutral-400 border border-[#2e2e3a] rounded"
              >
                #{tag}
              </span>
            ))}
            {model.tags.length > 3 && (
              <span className="text-[10px] text-neutral-500 self-center">
                +{model.tags.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
