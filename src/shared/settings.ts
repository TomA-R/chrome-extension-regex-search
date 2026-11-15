import { DEFAULT_OPTIONS, sameQuery, type Query, type SearchOptions } from '../core/query';

export interface Settings {
  defaults: SearchOptions;
  maxMatches: number;
  timeoutMs: number;
  debounceMs: number;
  searchFields: boolean;
  matchColor: string;
  currentColor: string;
  rememberLastQuery: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  defaults: DEFAULT_OPTIONS,
  maxMatches: 100_000,
  timeoutMs: 1500,
  debounceMs: 60,
  searchFields: true,
  matchColor: '#ffe066',
  currentColor: '#ff9632',
  rememberLastQuery: true,
};

export interface SavedPattern { name: string; query: Query }

const HISTORY_MAX = 50;

const COLOR = /^#[0-9a-f]{6}$/i;
const clamp = (v: unknown, min: number, max: number, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : dflt);

// Synced storage is an input boundary: values end up in CSS and limits.
export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Settings, unknown>>;
  const d = DEFAULT_SETTINGS;
  const bool = (v: unknown, dflt: boolean) => (typeof v === 'boolean' ? v : dflt);
  const defs = (r.defaults && typeof r.defaults === 'object' ? r.defaults : {}) as Partial<Record<keyof SearchOptions, unknown>>;
  return {
    defaults: {
      regex: bool(defs.regex, DEFAULT_OPTIONS.regex),
      caseSensitive: bool(defs.caseSensitive, DEFAULT_OPTIONS.caseSensitive),
      wholeWord: bool(defs.wholeWord, DEFAULT_OPTIONS.wholeWord),
      dotAll: bool(defs.dotAll, DEFAULT_OPTIONS.dotAll),
    },
    maxMatches: clamp(r.maxMatches, 1000, 1_000_000, d.maxMatches),
    timeoutMs: clamp(r.timeoutMs, 100, 10_000, d.timeoutMs),
    debounceMs: clamp(r.debounceMs, 0, 1000, d.debounceMs),
    searchFields: bool(r.searchFields, d.searchFields),
    matchColor: typeof r.matchColor === 'string' && COLOR.test(r.matchColor) ? r.matchColor : d.matchColor,
    currentColor: typeof r.currentColor === 'string' && COLOR.test(r.currentColor) ? r.currentColor : d.currentColor,
    rememberLastQuery: bool(r.rememberLastQuery, d.rememberLastQuery),
  };
}

export async function loadSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.sync.get('settings');
  return sanitizeSettings(settings);
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.sync.set({ settings: s });
}

export async function loadHistory(): Promise<Query[]> {
  const { history } = await chrome.storage.local.get('history');
  return (history as Query[] | undefined) ?? [];
}

export async function pushHistory(q: Query): Promise<Query[]> {
  if (!q.pattern) return loadHistory();
  const prev = await loadHistory();
  const next = [q, ...prev.filter((x) => !sameQuery(x, q))].slice(0, HISTORY_MAX);
  await chrome.storage.local.set({ history: next });
  return next;
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.set({ history: [] });
}

export async function loadSaved(): Promise<SavedPattern[]> {
  const { saved } = await chrome.storage.sync.get('saved');
  return (saved as SavedPattern[] | undefined) ?? [];
}

export async function saveSaved(list: SavedPattern[]): Promise<void> {
  await chrome.storage.sync.set({ saved: list });
}
