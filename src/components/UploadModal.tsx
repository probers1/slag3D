import React, { useState, useRef } from 'react';
import { X, Upload, FileCode, CheckCircle, AlertCircle } from 'lucide-react';
import { CollectionItem } from '../types';
import { apiFetch } from '../utils/api';

interface UploadModalProps {
  collections: CollectionItem[];
  onClose: () => void;
  onUploadSuccess: () => void;
}

// Error object type for uploads
type UploadErrorDetail = {
  message: string;
  type?: 'file' | 'network' | 'invalid';
  details?: string;
};

export const UploadModal: React.FC<UploadModalProps> = ({
  collections,
  onClose,
  onUploadSuccess,
}) => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [collectionId, setCollectionId] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<UploadErrorDetail | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFilesAdded = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    // Reject image files immediately
    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'];
    for (const file of files) {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext && imageExtensions.includes(ext)) {
        setUploadError({ 
          message: `${file.name}: Image files are not allowed`, 
          type: 'file' as const,
          details: 'We only accept 3D model files (.stl, .3mf, .obj) or archives (.zip, .7z)'
        });
        return;
      }
    }
    const newFiles = Array.from(files);
    setSelectedFiles((prev) => [...prev, ...newFiles]);
    if (!title && newFiles[0]) {
      const nameWithoutExt = newFiles[0].name.replace(/\.[^/.]+$/, '');
      setTitle(nameWithoutExt);
    }
  };

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Check if any file has no extension
    for (const file of selectedFiles) {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      
      // Reject files without extension or with disallowed extensions
      if (!ext || !['stl', '3mf', 'obj', 'zip', '7z'].includes(ext)) {
        setUploadError({ 
          message: `File: ${file.name.split('.')[0] || file.name}`, 
          type: 'file' as const,
          details: 'Please use only .stl, .3mf, .obj (3D models) or .zip, .7z (archives)'
        });
        return;
      }

      // Check for image masquerading attempts
      if (ext === 'stl' || ext === 'obj') {
        const nameWithoutExt = file.name.split('.')[0]?.toLowerCase();
        const suspiciousImageNames = ['screenshot', 'image', 'photo', 'picture', 'capture'];
        if (suspiciousImageNames.some(sn => nameWithoutExt.includes(sn))) {
          setUploadError({ 
            message: `File: ${file.name}: Suspicious filename for .${ext} model`, 
            type: 'file' as const,
            details: 'Files named "image" or "capture" with .stl/.obj extensions are likely not valid 3D models'
          });
          return;
        }
      }
    }

    if (selectedFiles.length === 0) {
      setUploadError({ 
        message: 'Please select at least one 3D file or archive', 
        type: 'file' as const 
      });
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    const formData = new FormData();
    formData.append('title', title);
    formData.append('description', description);
    formData.append('tags', tags);
    if (collectionId) {
      formData.append('collection_id', collectionId);
    }

    selectedFiles.forEach((file) => {
      formData.append('files', file);
    });

    try {
      const res = await apiFetch('/api/models', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        let message: string;
        try {
          const data = await res.json();
          message = data.error || data.message || `HTTP ${res.status}`;
        } catch {
          message = (await res.text()).trim() || `Upload failed: ${res.status}`;
        }

        // Categorize error type based on HTTP status and message content
        let errorType: UploadErrorDetail['type'] = 'network';
        
        if (res.status === 400) {
          const msgLower = message.toLowerCase();
          
          // Image file attempt
          if (msgLower.includes('image') || msgLower.includes('.jpg') || msgLower.includes('.png')) {
            errorType = 'file' as const;
            message += '. Only 3D models (.stl/.3mf/.obj) and archives allowed.';
          } else if (msgLower.includes('no extension') || msgLower.includes('extension ')) {
            errorType = 'file' as const;
          } else if (msgLower.includes('zip')) {
            errorType = 'file' as const;
            message += ' Ensure ZIP contains valid 3D models, not executables.';
          } else if (msgLower.includes('unsupported') || msgLower.includes('not allowed')) {
            errorType = 'file' as const;
          }
        }

        // Extract filename from error if present
        const nameMatch = message.match(/^"?(?:^|\s)([\w/.-]+)\s*[:.]|(?:"|\')?([\w/.-]+)/);
        if (nameMatch && !message.includes(':')) {
          message = `${nameMatch[1] || nameMatch[2] || 'File'}: ${message}`;
        }

        setUploadError({ 
          message, 
          type: errorType,
          details: errorType === 'file' ? undefined : undefined
        });
        return;
      }

      onUploadSuccess();
      onClose();
    } catch (err: any) {
      let errorMessage = 'An unknown error occurred';
      
      if (err?.message) {
        errorMessage = err.message;
      } else if (typeof err === 'string') {
        errorMessage = err;
      }

      // Check for file-related errors in message
      let errorType: UploadErrorDetail['type'] = 'network';
      const lowerMsg = errorMessage.toLowerCase();
      
      if (lowerMsg.includes('image')) {
        errorType = 'file' as const;
        errorMessage += ' (Only .stl/.3mf/.obj and archives allowed)';
      } else if (lowerMsg.includes('no extension') || lowerMsg.includes('extension')) {
        errorType = 'file' as const;
      }

      setUploadError({ 
        message: errorMessage, 
        type: errorType 
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-[#18181e] border border-[#2d2d38] rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#262632]">
          <div className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-blue-400" />
            <h2 className="text-base font-bold text-white">Upload 3D Asset or Archive</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
          {uploadError && (
            <div className="flex items-start gap-3 p-4 bg-red-950/30 border border-red-800/50 rounded-xl text-xs text-red-200">
              <AlertCircle className="w-5 h-5 shrink-0 text-red-400 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold mb-1">{uploadError.message}</p>
                {uploadError.details && (
                  <p className="text-red-300/80 pl-4">{uploadError.details}</p>
                )}
                {/* File-specific error display */}
                {uploadError.type === 'file' && (
                  <div className="mt-2 p-2 bg-red-900/50 rounded border border-red-800/30">
                    <p className="font-medium mb-1 text-red-300">Supported formats:</p>
                    <ul className="list-disc list-inside text-red-300/70 space-y-0.5">
                      <li>.stl, .3mf, .obj (3D model files)</li>
                      <li>.zip, .7z archives containing valid 3D models</li>
                      <li>Image files (.jpg, .png) are not allowed for 3D models</li>
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Dropzone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              handleFilesAdded(e.dataTransfer.files);
            }}
            className="border-2 border-dashed border-[#343444] hover:border-blue-500/60 bg-[#131317]/60 hover:bg-[#15151c] rounded-xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-colors"
          >
            <input
              type="file"
              ref={fileInputRef}
              multiple
              accept=".stl,.3mf,.obj,.zip,.7z,image/*"
              onChange={(e) => handleFilesAdded(e.target.files)}
              className="hidden"
            />
            <div className="w-12 h-12 rounded-full bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-blue-400 mb-3">
              <Upload className="w-6 h-6" />
            </div>
            <p className="text-sm font-semibold text-neutral-200">
              Drag & drop files here, or <span className="text-blue-400 underline">browse</span>
            </p>
            <p className="text-xs text-neutral-500 mt-1">
              Supports .STL, .3MF, .OBJ, and multi-file archives (.ZIP, .7Z) up to 300MB
            </p>
          </div>

          {/* Selected Files List */}
          {selectedFiles.length > 0 && (
            <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto pr-1">
              {selectedFiles.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-2 bg-[#202028] border border-[#2c2c38] rounded-lg text-xs"
                >
                  <div className="flex items-center gap-2 truncate">
                    <FileCode className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                    <span className="truncate text-neutral-200">{f.name}</span>
                    <span className="text-neutral-500 font-mono text-[10px]">
                      ({(f.size / 1024 / 1024).toFixed(2)} MB)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="p-1 text-neutral-500 hover:text-red-400"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Metadata Fields */}
          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1">Model Title</label>
              <input
                type="text"
                placeholder="e.g. Voron Stealthburner Toolhead"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="w-full bg-[#131317] border border-[#343444] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1">Tags (comma-separated)</label>
              <input
                type="text"
                placeholder="e.g. toolhead, voron, extruder, 3dprinter"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                className="w-full bg-[#131317] border border-[#343444] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1">Assign to Collection</label>
              <select
                value={collectionId}
                onChange={(e) => setCollectionId(e.target.value)}
                className="w-full bg-[#131317] border border-[#343444] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
              >
                <option value="">No Collection (Vault Root)</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.parent_folder_id ? `└── ${c.name}` : c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1">Description (Optional)</label>
              <textarea
                rows={3}
                placeholder="Print notes, slicing settings, filament recommendations..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-[#131317] border border-[#343444] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#262632]">
            <button
              type="button"
              onClick={onClose}
              disabled={isUploading}
              className="px-4 py-2 text-xs font-medium text-neutral-400 hover:text-white rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isUploading}
              className="flex items-center gap-1.5 px-5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg shadow-md shadow-blue-600/20 transition-all"
            >
              {isUploading ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Processing & Extracting...
                </>
              ) : (
                <>
                  <CheckCircle className="w-3.5 h-3.5" />
                  Upload & Queue Render
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
