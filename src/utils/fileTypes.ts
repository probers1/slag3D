import type { ModelFile } from '../types';

export function isPdfName(name: string): boolean {
  return /\.pdf$/i.test(name || '');
}

export function isPdfFile(file: Pick<ModelFile, 'original_name' | 'mime_type'>): boolean {
  return isPdfName(file.original_name) || file.mime_type === 'application/pdf';
}
