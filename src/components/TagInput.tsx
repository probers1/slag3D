import React from 'react';
import { TagItem } from '../types';

interface TagInputProps {
  value: string;
  onChange: (value: string) => void;
  suggestions: TagItem[];
  placeholder?: string;
}

const DEFAULT_COLOR = '#60a5fa';

export function tagNamesFromInput(value: string): string[] {
  return value
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
}

export const TagInput: React.FC<TagInputProps> = ({
  value,
  onChange,
  suggestions,
  placeholder = 'e.g. toolhead, voron, extruder',
}) => {
  const selected = new Set(tagNamesFromInput(value));
  const visible = suggestions.slice(0, 12);

  const toggle = (name: string) => {
    const next = tagNamesFromInput(value);
    const index = next.findIndex((entry) => entry.toLowerCase() === name.toLowerCase());
    if (index >= 0) next.splice(index, 1);
    else next.push(name);
    onChange(next.join(', '));
  };

  return (
    <div className="flex flex-col gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-[#131317] border border-[#343444] rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-blue-500 transition-colors"
      />
      {visible.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {visible.map((tag) => {
            const active = selected.has(tag.name.toLowerCase());
            const color = tag.color || DEFAULT_COLOR;
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggle(tag.name)}
                title={tag.description || `Toggle #${tag.name}`}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] border transition-all ${
                  active
                    ? 'bg-blue-600/20 border-blue-500/50 text-blue-200'
                    : 'bg-[#1b1b22] border-[#2c2c38] text-neutral-400 hover:text-white hover:border-neutral-500'
                }`}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: color }}
                />
                #{tag.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
