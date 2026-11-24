import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  RotateCcw,
  Search,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { ModelFile } from '../types';
import { apiFetch, getStoredToken } from '../utils/api';

interface PdfViewerProps {
  file: ModelFile;
}

interface SearchMatch {
  page: number;
}

interface HighlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
  matchIndex: number;
}

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;

export const PdfViewer: React.FC<PdfViewerProps> = ({ file }) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<any>(null);
  const renderTaskRef = useRef<any>(null);
  const textItemsRef = useRef<any[]>([]);
  const viewportRef = useRef<any>(null);

  const [loadKey, setLoadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [scale, setScale] = useState(1);
  const [fitScale, setFitScale] = useState(1);
  const [fitMode, setFitMode] = useState(true);
  const [rotation, setRotation] = useState(0);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [activeMatch, setActiveMatch] = useState(0);
  const [highlights, setHighlights] = useState<HighlightRect[]>([]);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [version, setVersion] = useState(0);

  const effectiveScale = fitMode ? fitScale : scale;

  // Load PDF bytes through the authenticated API so the viewer works for
  // logged-in users without relying on inline content-disposition.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const load = async () => {
      const response = await apiFetch(file.file_path);
      if (!response.ok) throw new Error(`Could not load PDF (HTTP ${response.status})`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
      if (cancelled) {
        await doc.destroy();
        return;
      }
      docRef.current = doc;
      setNumPages(doc.numPages);
      setPageNumber(1);
      setPageInput('1');
      setMatches([]);
      setQuery('');
      setVersion((v) => v + 1);
    };

    load().catch((err: any) => {
      if (!cancelled) setError(err?.message || 'Failed to open this PDF');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
      try { renderTaskRef.current?.cancel(); } catch {}
      docRef.current?.destroy();
      docRef.current = null;
    };
  }, [file.id, file.file_path, loadKey]);

  // Fit-to-stage scale, recomputed when the modal is resized.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !numPages) return;
    const update = () => {
      const doc = docRef.current;
      if (!doc) return;
      doc.getPage(pageNumber).then((page: any) => {
        const base = page.getViewport({ scale: 1, rotation });
        const availableWidth = Math.max(200, stage.clientWidth - 32);
        const availableHeight = Math.max(300, stage.clientHeight - 24);
        setFitScale(Math.min(availableWidth / base.width, availableHeight / base.height));
      }).catch(() => {});
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [numPages, pageNumber, rotation, version]);

  // Render the current page into the canvas and overlay a selectable text layer.
  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    const textLayerDiv = textLayerRef.current;
    if (!doc || !canvas || !textLayerDiv || numPages === 0) return;

    let cancelled = false;
    const render = async () => {
      try {
        try { renderTaskRef.current?.cancel(); } catch {}
        const page = await doc.getPage(pageNumber);
        if (cancelled) return;

        const base = page.getViewport({ scale: 1, rotation });
        const viewport = page.getViewport({ scale: effectiveScale, rotation });
        viewportRef.current = viewport;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const context = canvas.getContext('2d');
        if (!context) return;
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, viewport.width, viewport.height);

        const task = page.render({ canvasContext: context, viewport, background: '#ffffff' });
        renderTaskRef.current = task;
        await task.promise;
        if (cancelled) return;

        const textContent = await page.getTextContent();
        if (cancelled) return;
        textItemsRef.current = textContent.items as any[];
        textLayerDiv.innerHTML = '';
        textLayerDiv.style.width = `${viewport.width}px`;
        textLayerDiv.style.height = `${viewport.height}px`;
        const textLayer = new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport,
        });
        await textLayer.render();
        if (!cancelled) setPageSize({ width: viewport.width, height: viewport.height });
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException' && !cancelled) {
          setError(err?.message || 'Failed to render this page');
        }
      }
    };

    render();
    return () => { cancelled = true; };
  }, [numPages, pageNumber, effectiveScale, rotation, version]);

  // Search across every page using PDF text content (works for text-based PDFs).
  const runSearch = useCallback(async () => {
    const term = query.trim().toLowerCase();
    setMatches([]);
    setHighlights([]);
    setActiveMatch(0);
    if (!term || !docRef.current) return;

    const found: SearchMatch[] = [];
    const doc = docRef.current;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const text = await page.getTextContent();
      const pageText = (text.items as any[]).map((item) => item.str || '').join(' ').toLowerCase();
      let from = 0;
      while (true) {
        const index = pageText.indexOf(term, from);
        if (index === -1) break;
        found.push({ page: p });
        from = index + term.length;
        if (found.length > 500) break;
      }
      if (found.length > 500) break;
    }

    setMatches(found);
    if (found.length > 0) {
      setPageNumber(found[0].page);
      setPageInput(String(found[0].page));
    }
  }, [query]);

  useEffect(() => {
    const term = query.trim().toLowerCase();
    const viewport = viewportRef.current;
    const items = textItemsRef.current;
    if (!term || !viewport || items.length === 0 || !pageSize.width) {
      setHighlights([]);
      return;
    }

    const rects: HighlightRect[] = [];
    const matchesBeforePage = matches.filter((m) => m.page < pageNumber).length;
    let matchIndexOnPage = 0;
    for (const item of items) {
      const text = String(item.str || '');
      if (!text) continue;
      const lower = text.toLowerCase();
      const transform = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const fontHeight = Math.hypot(transform[2], transform[3]) || 10;
      const charWidth = text.length > 0 ? item.width / text.length : 0;
      let from = 0;
      while (true) {
        const index = lower.indexOf(term, from);
        if (index === -1) break;
        rects.push({
          left: transform[4] + index * charWidth,
          top: transform[5] - fontHeight,
          width: Math.max(term.length * charWidth, 2),
          height: fontHeight * 1.2,
          matchIndex: matchesBeforePage + matchIndexOnPage,
        });
        matchIndexOnPage++;
        from = index + term.length;
      }
    }
    setHighlights(rects);
  }, [query, matches, activeMatch, pageNumber, rotation, effectiveScale, pageSize]);

  const goToPage = useCallback((next: number) => {
    if (next < 1 || next > numPages || numPages === 0) return;
    setPageNumber(next);
    setPageInput(String(next));
  }, [numPages]);

  const goToMatch = useCallback((index: number) => {
    if (matches.length === 0) return;
    const wrapped = (index + matches.length) % matches.length;
    setActiveMatch(wrapped);
    const target = matches[wrapped].page;
    setPageNumber(target);
    setPageInput(String(target));
  }, [matches]);

  const changeScale = (delta: number) => {
    setFitMode(false);
    setScale((current) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number((current + delta).toFixed(2)))));
  };

  const downloadUrl = useMemo(() => {
    const token = getStoredToken();
    return token ? `${file.file_path}?token=${encodeURIComponent(token)}` : file.file_path;
  }, [file.file_path]);

  return (
    <div className="h-full w-full flex flex-col bg-[#101014]">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-[#2a2a36] bg-[#17171e] text-xs shrink-0">
        <div className="flex items-center gap-1 text-neutral-300">
          <button
            onClick={() => goToPage(pageNumber - 1)}
            disabled={pageNumber <= 1}
            className="p-1.5 rounded hover:bg-white/10 disabled:opacity-30"
            title="Previous page"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <input
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') goToPage(parseInt(pageInput, 10));
            }}
            onBlur={() => goToPage(parseInt(pageInput, 10) || pageNumber)}
            className="w-10 text-center bg-[#101014] border border-[#343444] rounded px-1 py-1 text-white font-mono"
            aria-label="Page number"
          />
          <span className="text-neutral-500 font-mono">/ {numPages || '—'}</span>
          <button
            onClick={() => goToPage(pageNumber + 1)}
            disabled={pageNumber >= numPages}
            className="p-1.5 rounded hover:bg-white/10 disabled:opacity-30"
            title="Next page"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="h-5 w-px bg-[#303040]" />

        <div className="flex items-center gap-1 text-neutral-300">
          <button onClick={() => changeScale(-0.2)} className="p-1.5 rounded hover:bg-white/10" title="Zoom out">
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            onClick={() => { setFitMode(true); }}
            className={`px-2 py-1 rounded hover:bg-white/10 ${fitMode ? 'text-blue-400' : ''}`}
            title="Fit page to view"
          >
            {Math.round(effectiveScale * 100)}%
          </button>
          <button onClick={() => changeScale(0.2)} className="p-1.5 rounded hover:bg-white/10" title="Zoom in">
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={() => setRotation((r) => (r + 90) % 360)}
            className="p-1.5 rounded hover:bg-white/10"
            title="Rotate clockwise"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>

        <div className="h-5 w-px bg-[#303040]" />

        <form
          onSubmit={(e) => { e.preventDefault(); runSearch(); }}
          className="flex items-center gap-1 flex-1 min-w-[180px]"
        >
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-2 top-2" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setMatches([]);
                setActiveMatch(0);
                setHighlights([]);
              }}
              placeholder="Search text in PDF"
              className="w-full bg-[#101014] border border-[#343444] rounded pl-7 pr-2 py-1.5 text-white placeholder:text-neutral-600 focus:outline-none focus:border-blue-500"
            />
          </div>
          {matches.length > 0 && (
            <span className="text-[10px] font-mono text-neutral-400 whitespace-nowrap">
              {activeMatch + 1}/{matches.length}
            </span>
          )}
          {matches.length > 0 && (
            <>
              <button type="button" onClick={() => goToMatch(activeMatch - 1)} className="p-1 rounded hover:bg-white/10" title="Previous match">
                <ChevronLeft className="w-3.5 h-3.5 text-neutral-300" />
              </button>
              <button type="button" onClick={() => goToMatch(activeMatch + 1)} className="p-1 rounded hover:bg-white/10" title="Next match">
                <ChevronRight className="w-3.5 h-3.5 text-neutral-300" />
              </button>
            </>
          )}
        </form>

        <a
          href={downloadUrl}
          download={file.original_name}
          className="p-1.5 rounded text-neutral-300 hover:text-white hover:bg-white/10"
          title="Download PDF"
        >
          <Download className="w-4 h-4" />
        </a>
      </div>

      {/* Document stage */}
      <div ref={stageRef} className="flex-1 overflow-auto flex items-start justify-center p-4 bg-[#101014]">
        {loading && (
          <div className="flex flex-col items-center justify-center gap-3 text-neutral-400 text-xs h-full min-h-[300px]">
            <Loader2 className="w-7 h-7 text-blue-400 animate-spin" />
            <span>Opening PDF...</span>
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center justify-center gap-3 text-center h-full min-h-[300px]">
            <FileText className="w-8 h-8 text-red-400/70" />
            <p className="text-sm text-red-300">{error}</p>
            <button
              onClick={() => setLoadKey((k) => k + 1)}
              className="px-3 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-500 rounded-lg"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && numPages > 0 && (
          <div
            className="relative shadow-2xl shrink-0 bg-white"
            style={{ width: pageSize.width || undefined, height: pageSize.height || undefined }}
          >
            <canvas ref={canvasRef} className="block" />
            <div ref={textLayerRef} className="textLayer" style={{ position: 'absolute', top: 0, left: 0 }} />
            {highlights.map((rect, i) => (
              <div
                key={i}
                className={`pointer-events-none absolute rounded-[2px] ${
                  rect.matchIndex === activeMatch ? 'bg-orange-400/45' : 'bg-yellow-300/35'
                }`}
                style={{
                  left: rect.left,
                  top: rect.top,
                  width: rect.width,
                  height: rect.height,
                }}
              />
            ))}
          </div>
        )}

        {!loading && !error && query.trim() && matches.length === 0 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-[#1f1f28] border border-[#343444] text-[11px] text-neutral-400">
            No text matches for “{query.trim()}”
          </div>
        )}
      </div>
    </div>
  );
};
