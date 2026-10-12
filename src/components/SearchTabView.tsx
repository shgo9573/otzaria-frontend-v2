import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Clock3, Search, SlidersHorizontal, X, ChevronDown } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../store';
import type { ContentLine, SearchResultItem, SearchTab } from '../types';
import { highlight, normalizeHe, processHtml } from '../utils/text';
import { Btn, EmptyState, Select, Spinner, Switch } from './ui';
import { fontStack } from './CommentaryPanel';
import { t } from '../i18n';

interface Opts {
  mode: 'advanced' | 'exact' | 'phrase' | 'fuzzy';
  category: string;
  limit: number;
  sortBy: 'catalogue' | 'relevance' | 'generation';
  gematria: boolean;
  slop: number;
  proximityScope: 'wordDistance' | 'sameParagraph' | 'sameSection';
  grouping: 'none' | 'sameSection' | 'identicalText' | 'byBook';
}
interface Cached {
  results: SearchResultItem[] | null;
  total: number;
  totalBooks?: number;
  error: string;
  q: string;
  opts: Opts;
}
const cache = new Map<string, Cached>();
const defaultOpts: Opts = { mode: 'advanced', category: 'all', limit: 100, sortBy: 'relevance', gematria: false, slop: 0, proximityScope: 'wordDistance', grouping: 'none' };
const resultKey = (r: SearchResultItem) => `${r.bookId}:${r.lineIndex}:${r.bookTitle}`;

function hasVisibleSnippet(value: string | undefined): boolean {
  return Boolean(
    String(value ?? '')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;|&#160;|&#xA0;/gi, ' ')
      .trim(),
  );
}

function normalizeEra(value: string | undefined): string {
  return normalizeHe(value || '')
    .replace(/ך/g, 'כ')
    .replace(/ם/g, 'מ')
    .replace(/ן/g, 'נ')
    .replace(/ף/g, 'פ')
    .replace(/ץ/g, 'צ');
}

export function generationRank(value: string | undefined): number {
  const era = normalizeEra(value);
  if (!era) return 99;
  if (era.includes('מקרא') || era.includes('תנך') || era.includes('bible') || era.includes('tanakh')) return 0;
  if (era.includes('תנא') || era.includes('tanna') || era.includes('mishna')) return 1;
  if (era.includes('אמורא') || era.includes('amora') || era.includes('talmud')) return 2;
  if (era.includes('סבורא') || era.includes('savora')) return 3;
  if (era.includes('גאונ') || era.includes('gaon') || era.includes('geonim')) return 4;
  if (era.includes('ראשונ') || era.includes('rishon')) return 5;
  if (era.includes('אחרונ') || era.includes('acharon') || era.includes('achron')) return 6;
  if (era.includes('חסיד') || era.includes('kabbal') || era.includes('קבל')) return 6;
  if (era.includes('זמנ') || era.includes('עכשו') || era.includes('מודרנ') || era.includes('modern') || era.includes('contemporary')) return 7;
  return 50;
}

export function generationLabel(value: string | undefined): string {
  const rank = generationRank(value);
  return (
    {
      0: 'מקרא',
      1: 'תנאים',
      2: 'אמוראים',
      3: 'סבוראים',
      4: 'גאונים',
      5: 'ראשונים',
      6: 'אחרונים',
      7: 'זמננו',
    } as Record<number, string>
  )[rank] || (value?.trim() ? value.trim() : 'תקופה לא ידועה');
}

export default function SearchTabView({ tab }: { tab: SearchTab }) {
  const { library, updateTab, openBookInNewTab, settings, recentSearches, recordSearch, removeRecentSearch, clearRecentSearches } = useApp();
  const lang = settings.interfaceLanguage;
  const cached = cache.get(tab.id);
  const [q, setQ] = useState(cached?.q ?? tab.query);
  const [opts, setOpts] = useState<Opts>(cached?.opts ?? defaultOpts);
  const [results, setResults] = useState<SearchResultItem[] | null>(cached?.results ?? null);
  const [total, setTotal] = useState(cached?.total ?? 0);
  const [totalBooks, setTotalBooks] = useState<number | undefined>(cached?.totalBooks);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(cached?.error ?? '');
  const [showOpts, setShowOpts] = useState(false);
  const [lastQ, setLastQ] = useState(cached?.q ?? '');
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ lines: ContentLine[]; error: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [fallbackSnippets, setFallbackSnippets] = useState<Record<string, string>>({});
  const [fallbackPending, setFallbackPending] = useState<Set<string>>(() => new Set());
  const fallbackSnippetRequests = useRef(new Set<string>());
  const inputRef = useRef<HTMLInputElement>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);

  const topCats = useMemo(() => library?.root.children.map((c) => c.name) ?? [], [library]);

  const persist = (patch: Partial<Cached>) => {
    const prev = cache.get(tab.id) ?? { results: null, total: 0, error: '', q: '', opts };
    cache.set(tab.id, { ...prev, ...patch });
  };

  const sorted = useMemo(() => {
    if (!results) return null;
    // Relevance and generation ordering must come from the search engine.
    // Client-side generation sorting would only reorder the loaded page and break pagination.
    if (opts.sortBy === 'relevance' || opts.sortBy === 'generation') return results;
    const catalogueIndex = new Map(library?.books.map((b, i) => [String(b.id), i]) ?? []);
    return results
      .map((result, index) => ({ result, index }))
      .sort((a, b) => {
        const ai = catalogueIndex.get(String(a.result.bookId)) ?? Number.MAX_SAFE_INTEGER;
        const bi = catalogueIndex.get(String(b.result.bookId)) ?? Number.MAX_SAFE_INTEGER;
        return ai - bi || a.result.lineIndex - b.result.lineIndex || a.index - b.index;
      })
      .map((x) => x.result);
  }, [results, opts.sortBy, library]);

  const selectedResult = useMemo(() => (sorted?.length ? sorted.find((r) => resultKey(r) === previewKey) ?? null : null), [sorted, previewKey]);

  // client-side grouping of the displayed page
  const grouped = useMemo(() => {
    if (!sorted) return null;
    if (opts.grouping === 'identicalText') {
      const seen = new Set<string>();
      const out: SearchResultItem[] = [];
      for (const r of sorted) {
        const k = normalizeHe(r.snippet || fallbackSnippets[resultKey(r)] || '').slice(0, 160);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(r);
      }
      return [{ title: '', items: out }];
    }
    if (opts.grouping === 'byBook' || opts.grouping === 'sameSection') {
      const map = new Map<string, SearchResultItem[]>();
      for (const r of sorted) {
        const k = opts.grouping === 'byBook' ? r.bookTitle : `${r.bookTitle} · ${r.reference || ''}`;
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(r);
      }
      return Array.from(map.entries()).map(([title, items]) => ({ title, items }));
    }
    return [{ title: '', items: sorted }];
  }, [sorted, opts.grouping, opts.sortBy, library, fallbackSnippets]);

  const buildParams = (text: string, o: Opts, offset: number) => ({
    query: text,
    limit: o.limit,
    offset,
    category: o.category,
    exactMatch: o.mode === 'exact',
    gematriaSearch: o.gematria,
    mode: o.mode,
    sortBy: o.sortBy,
    slop: o.slop,
    proximityScope: o.proximityScope,
    resultGrouping: o.grouping === 'byBook' ? 'none' : o.grouping,
  });

  const run = useCallback(
    async (query: string, o: Opts) => {
      const text = query.trim();
      if (!text) return;
      setLoading(true);
      setError('');
      setLastQ(text);
      setResults(null);
      setPreviewKey(null);
      setPreview(null);
      setShowOpts(false);
      recordSearch(text);
      updateTab(tab.id, { query: text, title: 'חיפוש' });
      try {
        const r = await api.search(buildParams(text, o, 0));
        setResults(r.results);
        setTotal(Math.max(r.resultsCount, r.results.length));
        setTotalBooks(r.totalBooks ?? new Set(r.results.map((x) => String(x.bookId))).size);
        persist({ results: r.results, total: Math.max(r.resultsCount, r.results.length), totalBooks: r.totalBooks, error: '', q: text, opts: o });
      } catch (e) {
        const msg = (e as Error).message;
        setError(msg);
        persist({ results: null, error: msg, q: text, opts: o });
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recordSearch, tab.id, updateTab],
  );

  const loadMore = async () => {
    if (!results || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await api.search(buildParams(lastQ, opts, results.length));
      const seen = new Set(results.map(resultKey));
      const fresh = r.results.filter((x) => !seen.has(resultKey(x)));
      const next = [...results, ...fresh];
      setResults(next);
      if (fresh.length === 0) setTotal(next.length); // server doesn't paginate – stop offering more
      persist({ results: next, total: fresh.length === 0 ? next.length : total });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (!cached && tab.query) run(tab.query, opts);
    else inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab.query && tab.query !== lastQ && tab.query !== q) {
      setQ(tab.query);
      run(tab.query, opts);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.query]);

  useEffect(() => {
    const missing = (results ?? []).filter((result) => {
      const key = resultKey(result);
      return !hasVisibleSnippet(result.snippet) && !fallbackSnippetRequests.current.has(key);
    });
    if (missing.length === 0) return;

    const keys = missing.map(resultKey);
    missing.forEach((result) => fallbackSnippetRequests.current.add(resultKey(result)));
    setFallbackPending((current) => new Set([...current, ...keys]));

    const byBook = new Map<string, SearchResultItem[]>();
    for (const result of missing) {
      const key = String(result.bookId);
      const items = byBook.get(key) ?? [];
      items.push(result);
      byBook.set(key, items);
    }

    const batches: Array<{
      bookId: SearchResultItem['bookId'];
      start: number;
      end: number;
      items: SearchResultItem[];
    }> = [];

    for (const itemsForBook of byBook.values()) {
      const ordered = [...itemsForBook].sort((a, b) => a.lineIndex - b.lineIndex);
      let items: SearchResultItem[] = [];
      let startLine = 0;
      let endLine = 0;
      const flush = () => {
        if (!items.length) return;
        batches.push({ bookId: items[0].bookId, start: startLine, end: endLine, items });
        items = [];
        startLine = 0;
        endLine = 0;
      };

      for (const result of ordered) {
        const line = Math.max(1, Math.floor(Number(result.lineIndex) || 1));
        if (items.length > 0 && line - startLine > 30) flush();
        if (items.length === 0) startLine = line;
        endLine = line;
        items.push(result);
      }
      flush();
    }

    let cursor = 0;
    const worker = async () => {
      while (cursor < batches.length) {
        const batch = batches[cursor++];
        try {
          const data = await api.content(batch.bookId, batch.start, batch.end);
          const lines = new Map(data.lines.map((line) => [Number(line.lineIndex), line.content]));
          const found: Record<string, string> = {};
          for (const result of batch.items) {
            const line = lines.get(Number(result.lineIndex));
            if (line?.trim()) found[resultKey(result)] = line;
          }
          if (Object.keys(found).length) {
            setFallbackSnippets((current) => ({ ...current, ...found }));
          }
        } catch {
          // Keep the book title and reference visible if the content endpoint fails.
        }
      }
    };

    void Promise.all(Array.from({ length: Math.min(4, batches.length) }, () => worker())).finally(() => {
      setFallbackPending((current) => {
        const next = new Set(current);
        keys.forEach((key) => next.delete(key));
        return next;
      });
    });
    // fallbackSnippetRequests is intentionally not a dependency: each result key is requested once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);
  useEffect(() => {
    if (!selectedResult) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreview(null);
    api
      .content(selectedResult.bookId, Math.max(1, selectedResult.lineIndex - 4), selectedResult.lineIndex + 12)
      .then((d) => !cancelled && setPreview({ lines: d.lines, error: '' }))
      .catch((e) => !cancelled && setPreview({ lines: [], error: e.message || 'לא ניתן לטעון תצוגה מקדימה' }))
      .finally(() => !cancelled && setPreviewLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selectedResult?.bookId, selectedResult?.lineIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // Center the exact matched line inside the scrollable preview, rather than
  // merely showing the surrounding excerpt from the content API.
  useEffect(() => {
    if (!preview || preview.error || !selectedResult || preview.lines.length === 0) return;
    const container = previewScrollRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>('[data-preview-target="true"]');
    if (!target) return;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const targetTop = container.scrollTop + targetRect.top - containerRect.top;
    container.scrollTop = Math.max(
      0,
      targetTop - Math.max(0, (container.clientHeight - target.offsetHeight) / 2),
    );
  }, [preview, selectedResult?.bookId, selectedResult?.lineIndex]);

  const textOpts = useMemo(
    () => ({ nikud: settings.showNikud, teamim: settings.showTeamim, punctuation: settings.showPunctuation, holyName: settings.holyNameReplacement }),
    [settings.showNikud, settings.showTeamim, settings.showPunctuation, settings.holyNameReplacement],
  );

  const openResult = (r: SearchResultItem) => {
    const matches = (results ?? []).filter((x) => String(x.bookId) === String(r.bookId)).map((x) => x.lineIndex).sort((a, b) => a - b);
    openBookInNewTab({ id: r.bookId, title: r.bookTitle, categoryPath: r.categoryPath }, r.lineIndex, { text: lastQ, matches });
  };

  const hasMore = !!results && total > results.length;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="border-b border-outline-variant px-3 py-2.5 md:px-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(q, opts);
          }}
          className="flex items-center gap-2"
        >
          <div className="relative max-w-3xl flex-1">
            <Search size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-on-variant" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => {
                const v = e.target.value;
                setQ(v);
                if (!v.trim()) {
                  setResults(null);
                  setError('');
                  setPreviewKey(null);
                  persist({ results: null, error: '', q: '' });
                }
              }}
              placeholder={t('חיפוש בכל הספרייה', lang)}
              className="h-11 w-full rounded-full border border-outline-variant bg-surface-2 pr-11 pl-10 text-[15px] outline-none focus:border-primary focus:bg-surface"
            />
            {q && (
              <button type="button" onClick={() => setQ('')} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-variant">
                <X size={18} />
              </button>
            )}
          </div>
          <Btn type="submit" variant="filled">
            {t('חפש', lang)}
          </Btn>
          <button
            type="button"
            onClick={() => setShowOpts((s) => !s)}
            className={`flex h-10 items-center gap-1 rounded-full px-3 text-sm ${showOpts ? 'bg-sec-container text-on-sec-container' : 'text-on-variant hover:bg-surface-3'}`}
            title="אפשרויות חיפוש"
          >
            <SlidersHorizontal size={18} /> <ChevronDown size={14} className={`transition ${showOpts ? 'rotate-180' : ''}`} />
          </button>
        </form>

        {showOpts && (
          <div className="fade-in mt-2 flex max-w-4xl flex-wrap items-end gap-3 rounded-2xl border border-outline-variant bg-surface-1 px-4 py-3">
            <label className="text-xs text-on-variant">
              סוג חיפוש
              <Select
                className="mt-1 block"
                value={opts.mode}
                onChange={(mode) => setOpts({ ...opts, mode })}
                options={[
                  { value: 'advanced', label: 'חיפוש מתקדם' },
                  { value: 'exact', label: 'התאמה מדויקת' },
                  { value: 'phrase', label: 'ביטוי' },
                  { value: 'fuzzy', label: 'חיפוש מקורב' },
                ]}
              />
            </label>
            <label className="text-xs text-on-variant">
              קטגוריה
              <Select className="mt-1 block max-w-[180px]" value={opts.category} onChange={(category) => setOpts({ ...opts, category })} options={[{ value: 'all', label: 'כל הספרייה' }, ...topCats.map((c) => ({ value: c, label: c }))]} />
            </label>
            <label className="text-xs text-on-variant">
              מיון
              <Select
                className="mt-1 block"
                value={opts.sortBy}
                onChange={(sortBy) => setOpts({ ...opts, sortBy })}
                options={[
                  { value: 'relevance', label: 'לפי רלוונטיות' },
                  { value: 'catalogue', label: 'לפי סדר הספרייה' },
                  { value: 'generation', label: 'לפי תקופה' },
                ]}
              />
            </label>
            <label className="text-xs text-on-variant">
              תוצאות בכל טעינה
              <Select className="mt-1 block" value={opts.limit} onChange={(limit) => setOpts({ ...opts, limit })} options={[50, 100, 200, 500].map((n) => ({ value: n, label: String(n) }))} />
            </label>
            <label className="text-xs text-on-variant">
              מרחק בין מילים
              <Select
                className="mt-1 block"
                value={opts.slop}
                onChange={(slop) => setOpts({ ...opts, slop })}
                options={[
                  { value: 0, label: 'צמודות' },
                  { value: 2, label: 'עד 2 מילים' },
                  { value: 5, label: 'עד 5 מילים' },
                  { value: 10, label: 'עד 10 מילים' },
                  { value: 30, label: 'עד 30 מילים' },
                ]}
              />
            </label>
            <label className="text-xs text-on-variant">
              תחום הקרבה
              <Select
                className="mt-1 block"
                value={opts.proximityScope}
                onChange={(proximityScope) => setOpts({ ...opts, proximityScope })}
                options={[
                  { value: 'wordDistance', label: 'מרחק מילים' },
                  { value: 'sameParagraph', label: 'אותה פסקה' },
                  { value: 'sameSection', label: 'אותו קטע' },
                ]}
              />
            </label>
            <label className="text-xs text-on-variant">
              קיבוץ תוצאות
              <Select
                className="mt-1 block"
                value={opts.grouping}
                onChange={(grouping) => setOpts({ ...opts, grouping })}
                options={[
                  { value: 'none', label: 'ללא' },
                  { value: 'byBook', label: 'לפי ספר' },
                  { value: 'sameSection', label: 'אותו קטע' },
                  { value: 'identicalText', label: 'טקסט זהה' },
                ]}
              />
            </label>
            <label className="flex items-center gap-2 pb-1 text-sm">
              <Switch checked={opts.gematria} onChange={(gematria) => setOpts({ ...opts, gematria })} /> גימטריה
            </label>
            <Btn variant="tonal" onClick={() => run(q, opts)} disabled={!q.trim()}>
              החל וחפש
            </Btn>
          </div>
        )}
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
        {/* results – right side (first in RTL) */}
        <section className="min-h-0 min-w-0 flex-1 overflow-y-auto px-3 pb-8 md:px-6" style={{ order: 1 }}>
          {loading && <Spinner label="מחפש..." />}
          {error && !loading && <div className="m-4 rounded-xl bg-surface-2 p-4 text-sm text-error">{error}</div>}

          {!loading && !results && !error && !q.trim() && recentSearches.length > 0 && (
            <div className="mx-auto max-w-3xl py-4">
              <div className="mb-3 flex items-center justify-between px-2">
                <div className="flex items-center gap-2 text-sm font-medium text-on-variant">
                  <Clock3 size={17} /> חיפושים אחרונים
                </div>
                <button onClick={clearRecentSearches} className="text-xs text-primary hover:underline">
                  מחיקת הכול
                </button>
              </div>
              {recentSearches.map((item) => (
                <div key={`${item.query}-${item.searchedAt}`} className="mb-1 flex items-center rounded-xl hover:bg-surface-3">
                  <button
                    onClick={() => {
                      setQ(item.query);
                      run(item.query, opts);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-start"
                  >
                    <Search size={16} className="shrink-0 text-on-variant" />
                    <span className="truncate">{item.query}</span>
                  </button>
                  <button onClick={() => removeRecentSearch(item.query)} className="rounded-full p-2 text-on-variant hover:bg-surface-2" title="מחק חיפוש">
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {!loading && !results && !error && !q.trim() && recentSearches.length === 0 && (
            <EmptyState icon={<Search size={60} />} title="חיפוש בכל הספרייה" hint="הקלידו מילה או ביטוי ולחצו Enter. ניתן לדייק את החיפוש באמצעות האפשרויות." />
          )}
          {!loading && !results && !error && q.trim() && <EmptyState icon={<Search size={44} />} title="לחצו Enter כדי להתחיל בחיפוש" />}

          {!loading && sorted && (
            <div className="mx-auto max-w-4xl">
              <div className="py-3 text-sm text-on-variant">
                {sorted.length === 0 ? (
                  'לא נמצאו תוצאות'
                ) : total > sorted.length ? (
                  <>
                    נמצאו <b>{total.toLocaleString('he-IL')}</b> מופעים{totalBooks ? <> ב־<b>{totalBooks}</b> ספרים</> : null} עבור "{lastQ}" · מוצגות <b>{sorted.length}</b> תוצאות
                  </>
                ) : (
                  <>
                    נמצאו <b>{sorted.length.toLocaleString('he-IL')}</b> תוצאות{totalBooks ? <> ב־<b>{totalBooks}</b> ספרים</> : null} עבור "{lastQ}"
                  </>
                )}
                <span className="mr-2 text-xs">(לחיצה – תצוגה מקדימה, לחיצה כפולה – פתיחה בלשונית)</span>
              </div>
              {sorted.length > 0 && (
                <div className="sticky top-0 z-[2] mb-2 flex flex-wrap items-center gap-2 bg-surface/95 py-2 backdrop-blur">
                  <span className="text-xs text-on-variant">{t('מיון', lang)}:</span>
                  {(
                    [
                      ['relevance', 'רלוונטיות'],
                      ['catalogue', 'סדר הספרייה'],
                      ['generation', 'תקופה'],
                    ] as const
                  ).map(([v, label]) => (
                    <button
                      key={v}
                      onClick={() => {
                        const nextOpts = { ...opts, sortBy: v };
                        setOpts(nextOpts);
                        if (lastQ.trim()) void run(lastQ, nextOpts);
                      }}
                      className={`rounded-full border px-3 py-1 text-xs transition ${
                        opts.sortBy === v ? 'border-transparent bg-sec-container text-on-sec-container' : 'border-outline-variant text-on-variant hover:bg-surface-3'
                      }`}
                    >
                      {t(label, lang)}
                    </button>
                  ))}
                  <span className="mr-3 text-xs text-on-variant">{t('קיבוץ', lang)}:</span>
                  {(
                    [
                      ['none', 'ללא'],
                      ['byBook', 'לפי ספר'],
                      ['sameSection', 'קטע'],
                      ['identicalText', 'טקסט זהה'],
                    ] as const
                  ).map(([v, label]) => (
                    <button
                      key={v}
                      onClick={() => setOpts((o) => ({ ...o, grouping: v }))}
                      className={`rounded-full border px-3 py-1 text-xs transition ${
                        opts.grouping === v ? 'border-transparent bg-sec-container text-on-sec-container' : 'border-outline-variant text-on-variant hover:bg-surface-3'
                      }`}
                    >
                      {t(label, lang)}
                    </button>
                  ))}
                  <span className="text-[11px] text-on-variant">{lang === 'en' ? 'Sorting is handled by the search engine across pages' : 'המיון מתבצע במנוע החיפוש ונשמר בין עמודים'}</span>
                </div>
              )}
              {grouped?.map((group) => (
                <div key={group.title || 'all'}>
                  {group.title && (
                    <div className="sticky top-0 z-[1] bg-surface/95 py-1.5 text-sm font-bold text-primary backdrop-blur">
                      {group.title} <span className="font-normal text-on-variant">({group.items.length})</span>
                    </div>
                  )}
                  {group.items.map((r) => {
                    const k = resultKey(r);
                    const sel = k === previewKey;
                    const displaySnippet = hasVisibleSnippet(r.snippet) ? String(r.snippet) : (fallbackSnippets[k] || '');
                    return (
                      <button
                        key={k}
                        onClick={() => setPreviewKey(k)}
                        onDoubleClick={() => openResult(r)}
                        className={`fade-in mb-2 block w-full rounded-2xl border px-4 py-3 text-start transition ${sel ? 'border-primary/50 bg-primary/5' : 'border-outline-variant bg-surface-1 hover:bg-surface-3'}`}
                      >
                        <div className="flex items-baseline gap-2">
                          <span className="font-bold text-primary">{r.bookTitle}</span>
                          {r.reference && <span className="text-sm text-on-variant">{r.reference}</span>}
                          <span className="shrink-0 text-xs text-on-variant">שורה {r.lineIndex}</span>
                          {opts.sortBy === 'generation' &&
                            (() => {
                              const era = library?.byId.get(String(r.bookId))?.heEra;
                              return era ? (
                                <span className="shrink-0 rounded-full bg-sec-container px-2 py-0.5 text-[11px] text-on-sec-container">
                                  {era}
                                </span>
                              ) : null;
                            })()}
                        </div>
                        {r.categoryPath && <div className="mb-1 text-xs text-on-variant">{r.categoryPath}</div>}
                        {hasVisibleSnippet(displaySnippet) ? (
                          <div
                            dir="rtl"
                            className="book-text mt-1 line-clamp-4 text-[17px] leading-relaxed"
                            style={{ fontFamily: fontStack(settings.fontFamily) }}
                            dangerouslySetInnerHTML={{ __html: highlight(processHtml(displaySnippet, textOpts), lastQ) }}
                          />
                        ) : (
                          <div dir="rtl" className="mt-1 text-sm text-on-variant" role="status">{fallbackPending.has(k) ? 'טוען את שורת התוצאה…' : 'טקסט השורה אינו זמין כרגע'}</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
              {hasMore && (
                <div className="py-3 text-center">
                  <Btn variant="tonal" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? 'טוען…' : `טען עוד תוצאות (מוצגות ${sorted.length} מתוך ${total.toLocaleString('he-IL')})`}
                  </Btn>
                </div>
              )}
            </div>
          )}
        </section>

        {/* preview – left side */}
        {selectedResult && (
          <aside
            className="flex max-h-[55vh] min-h-[320px] shrink-0 flex-col border-t border-outline-variant bg-surface-1 lg:max-h-none lg:min-h-0 lg:w-[min(460px,42%)] lg:border-t-0 lg:border-r"
            style={{ order: 2 }}
          >
            <div className="border-b border-outline-variant p-4">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-lg font-medium">{selectedResult.bookTitle}</div>
                  <div className="text-xs text-on-variant">
                    {selectedResult.reference || `שורה ${selectedResult.lineIndex}`}
                    {selectedResult.categoryPath && ` · ${selectedResult.categoryPath}`}
                  </div>
                </div>
                <button onClick={() => setPreviewKey(null)} className="rounded-full p-1 text-on-variant hover:bg-surface-3" aria-label="סגור תצוגה מקדימה">
                  <X size={18} />
                </button>
              </div>
              <Btn variant="filled" className="mt-3 w-full" onClick={() => openResult(selectedResult)}>
                <BookOpen size={16} /> פתח בלשונית חדשה
              </Btn>
            </div>
            <div ref={previewScrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
              {previewLoading && <Spinner label="טוען תצוגה מקדימה..." />}
              {preview?.error && <div className="text-sm text-error">{preview.error}</div>}
              {preview && !preview.error && preview.lines.length > 0 && (
                <div className="book-text" style={{ fontFamily: fontStack(settings.fontFamily), fontSize: Math.max(16, settings.fontSize - 3), lineHeight: settings.lineHeight }}>
                  {preview.lines.map((line) => {
                    const isTarget = line.lineIndex === selectedResult.lineIndex;
                    return (
                      <div key={line.lineIndex} data-preview-target={isTarget ? 'true' : undefined} className={`mb-1 rounded px-2 py-1 ${isTarget ? 'bg-primary/15' : ''}`}>
                        {line.heRef && (
                          <div className="mb-0.5 text-[11px] text-on-variant" style={{ fontFamily: 'Heebo, sans-serif' }}>
                            {line.heRef}
                          </div>
                        )}
                        <div dangerouslySetInnerHTML={{ __html: highlight(processHtml(line.content, textOpts), lastQ) }} />
                      </div>
                    );
                  })}
                </div>
              )}
              {preview && !preview.error && preview.lines.length === 0 && (
                <div className="book-text text-base leading-relaxed" dangerouslySetInnerHTML={{ __html: highlight(processHtml(selectedResult.snippet, textOpts), lastQ) }} />
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
