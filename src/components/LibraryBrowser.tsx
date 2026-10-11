import { useMemo, useRef, useState, useEffect } from 'react';
import { ArrowRight, BookText, ChevronLeft, Folder, LayoutGrid, List, RefreshCw, Search, X, Home } from 'lucide-react';
import { useApp } from '../store';
import { Btn, EmptyState, IconBtn, Spinner } from './ui';
import { normalizeHe } from '../utils/text';
import { DailyStudyStrip } from './DailyStudy';
import { t } from '../i18n';
import type { BookItem } from '../types';

export default function LibraryBrowser() {
  const { library, libraryLoading, libraryError, reloadLibrary, settings, updateSettings, openBook, history, screen, removeHistoryItem, clearHistory } = useApp();
  const [path, setPath] = useState('');
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const goHome = () => {
    setPath('');
    setQuery('');
    listRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    inputRef.current?.focus();
  };

  useEffect(() => {
    if (screen === 'library') inputRef.current?.focus();
  }, [screen]);

  const node = library?.nodes.get(path) ?? library?.root;
  const grid = settings.libraryViewMode === 'grid';
  const lang = settings.interfaceLanguage;

  const results = useMemo(() => {
    const q = normalizeHe(query.trim());
    if (!q || !library) return null;
    const words = q.split(/\s+/);
    const out: BookItem[] = [];
    for (const b of library.books) {
      const hay = normalizeHe(b.title + ' ' + (b.author || '') + ' ' + b.categoryPath);
      if (words.every((w) => hay.includes(w))) {
        out.push(b);
        if (out.length >= 300) break;
      }
    }
    // title matches first
    out.sort((a, b) => {
      const at = normalizeHe(a.title).includes(q) ? 0 : 1;
      const bt = normalizeHe(b.title).includes(q) ? 0 : 1;
      return at - bt;
    });
    return out;
  }, [query, library]);

  const crumbs = path ? path.split('/') : [];

  const recent = useMemo(() => history.slice(0, 10), [history]);

  const BookRow = ({ b, showPath }: { b: BookItem; showPath?: boolean }) =>
    grid ? (
      <button
        onClick={() => openBook(b)}
        title={settings.showBookPreview ? [b.author, b.heDesc].filter(Boolean).join(' – ') : undefined}
        className="flex h-28 flex-col items-center justify-center gap-2 rounded-2xl border border-outline-variant bg-surface-1 p-3 text-center transition hover:bg-surface-3"
      >
        <BookText size={26} className="text-primary" />
        <span className="line-clamp-2 text-sm leading-tight">{b.title}</span>
      </button>
    ) : (
      <button
        onClick={() => openBook(b)}
        title={settings.showBookPreview ? b.heDesc || undefined : undefined}
        className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-start transition hover:bg-surface-3"
      >
        <BookText size={22} className="shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[17px]">{b.title}</span>
          {(showPath || b.author) && (
            <span className="block truncate text-xs text-on-variant">
              {showPath ? b.categoryPath : ''}
              {showPath && b.author ? ' • ' : ''}
              {b.author}
            </span>
          )}
        </span>
      </button>
    );

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* top bar */}
      <div className="flex items-center gap-2 border-b border-outline-variant px-3 py-2.5 md:px-5">
        {path && !query ? (
          <IconBtn title="חזרה" onClick={() => setPath(path.split('/').slice(0, -1).join('/'))}>
            <ArrowRight size={22} />
          </IconBtn>
        ) : (
          <IconBtn title="לראש הספרייה" onClick={goHome}>
            <Home size={20} />
          </IconBtn>
        )}
        <div className="relative max-w-2xl flex-1">
          <Search size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-on-variant" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('איתור ספר בספרייה', lang)}
            className="h-11 w-full rounded-full border border-outline-variant bg-surface-2 pr-11 pl-10 text-[15px] outline-none transition focus:border-primary focus:bg-surface"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-variant">
              <X size={18} />
            </button>
          )}
        </div>
        <div className="mr-auto flex items-center gap-1">
          <IconBtn title={grid ? 'תצוגת רשימה' : 'תצוגת רשת'} onClick={() => updateSettings({ libraryViewMode: grid ? 'list' : 'grid' })}>
            {grid ? <List size={20} /> : <LayoutGrid size={20} />}
          </IconBtn>
          <IconBtn title="רענן ספרייה" onClick={reloadLibrary}>
            <RefreshCw size={19} />
          </IconBtn>
        </div>
      </div>

      {/* breadcrumbs */}
      {!query && (
        <div className="flex items-center gap-1 overflow-x-auto px-4 py-2 text-sm text-on-variant md:px-6">
          <button onClick={() => setPath('')} className={`rounded px-1.5 py-0.5 hover:bg-surface-3 ${!path ? 'font-medium text-on-surface' : ''}`}>
            {t('ספרייה', lang)}
          </button>
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1 whitespace-nowrap">
              <ChevronLeft size={14} />
              <button
                onClick={() => setPath(crumbs.slice(0, i + 1).join('/'))}
                className={`rounded px-1.5 py-0.5 hover:bg-surface-3 ${i === crumbs.length - 1 ? 'font-medium text-on-surface' : ''}`}
              >
                {c}
              </button>
            </span>
          ))}
        </div>
      )}

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-6 md:px-5">
        {libraryLoading && !library && <Spinner label="טוען את הספרייה..." />}
        {libraryError && !library && (
          <EmptyState icon={<BookText size={56} />} title="לא ניתן לטעון את הספרייה" hint={libraryError}>
            <Btn variant="filled" onClick={reloadLibrary}>
              <RefreshCw size={16} /> נסה שוב
            </Btn>
          </EmptyState>
        )}

        {library && results && (
          <div className="fade-in mx-auto max-w-5xl">
            <div className="px-3 py-2 text-sm text-on-variant">
              {results.length === 0 ? 'לא נמצאו ספרים' : `נמצאו ${results.length}${results.length >= 300 ? '+' : ''} ספרים`}
            </div>
            <div className={grid ? 'grid grid-cols-2 gap-3 p-2 sm:grid-cols-3 lg:grid-cols-5' : ''}>
              {results.map((b) => (
                <BookRow key={String(b.id)} b={b} showPath />
              ))}
            </div>
          </div>
        )}

        {library && !results && node && (
          <div className="fade-in mx-auto max-w-5xl">
            {!path && <DailyStudyStrip />}
            {!path && recent.length > 0 && (
              <div className="mb-4 px-2 pt-1">
                <div className="mb-2 flex items-center justify-between px-1 text-sm text-on-variant">
                  <span>{t('המשך קריאה', lang)}</span>
                  <button onClick={() => { if (confirm('למחוק את כל היסטוריית הקריאה?')) clearHistory(); }} className="text-xs text-primary hover:underline">
                    {t('נקה היסטוריה', lang)}
                  </button>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {recent.map((h) => (
                    <div key={h.id} className="group relative min-w-[160px] max-w-[210px] shrink-0 rounded-2xl bg-sec-container text-on-sec-container transition hover:brightness-95">
                      <button onClick={() => openBook({ id: h.bookId, title: h.bookTitle, categoryPath: h.category }, h.lastPosition)} className="w-full px-4 py-2.5 pl-8 text-start">
                        <div className="truncate text-sm font-medium">{h.bookTitle}</div>
                        <div className="truncate text-xs opacity-70">{h.lastSection || `שורה ${h.lastPosition ?? 1}`}</div>
                      </button>
                      <button
                        onClick={() => removeHistoryItem(h)}
                        className="absolute left-1.5 top-1.5 rounded-full p-1 opacity-50 hover:bg-surface/50 hover:opacity-100"
                        title="הסר מההיסטוריה"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className={grid ? 'grid grid-cols-2 gap-3 p-2 sm:grid-cols-3 lg:grid-cols-5' : ''}>
              {node.children.map((c) =>
                grid ? (
                  <button
                    key={c.path}
                    onClick={() => setPath(c.path)}
                    className="flex h-28 flex-col items-center justify-center gap-2 rounded-2xl bg-sec-container p-3 text-center text-on-sec-container transition hover:brightness-95"
                  >
                    <Folder size={28} />
                    <span className="line-clamp-2 text-sm font-medium leading-tight">{c.name}</span>
                    <span className="text-[11px] opacity-70">{c.count} ספרים</span>
                  </button>
                ) : (
                  <button
                    key={c.path}
                    onClick={() => setPath(c.path)}
                    className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-start transition hover:bg-surface-3"
                  >
                    <Folder size={22} className="shrink-0 text-primary" fill="currentColor" fillOpacity={0.15} />
                    <span className="flex-1 truncate text-[17px] font-medium">{c.name}</span>
                    <span className="text-xs text-on-variant">{c.count}</span>
                    <ChevronLeft size={16} className="text-on-variant" />
                  </button>
                ),
              )}
              {node.books.map((b) => (
                <BookRow key={String(b.id)} b={b} />
              ))}
            </div>
            {node.children.length === 0 && node.books.length === 0 && (
              <EmptyState icon={<Folder size={52} />} title="התיקייה ריקה" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
