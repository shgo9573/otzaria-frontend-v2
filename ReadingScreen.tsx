import { useEffect, useRef } from 'react';
import { BookOpen, Search as SearchIcon, X } from 'lucide-react';
import { useApp } from '../store';
import BookViewer from './BookViewer';
import SearchTabView from './SearchTabView';
import { Btn, EmptyState } from './ui';
import { t } from '../i18n';

export default function ReadingScreen() {
  const { tabs, activeTabId, setActiveTab, closeTab, setScreen, openSearch, settings } = useApp();
  const lang = settings.interfaceLanguage;
  const active = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  const stripRef = useRef<HTMLDivElement>(null);

  // keep the active tab visible when there are many tabs
  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>(`[data-tab="${active?.id}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [active?.id, tabs.length]);

  if (tabs.length === 0) {
    return (
      <EmptyState icon={<BookOpen size={64} />} title={t('אין לשוניות פתוחות', lang)} hint={lang === 'en' ? 'Choose a book from the library or search to start reading.' : 'בחרו ספר מהספרייה או בצעו חיפוש כדי להתחיל לקרוא'}>
        <div className="mt-2 flex gap-2">
          <Btn variant="filled" onClick={() => setScreen('library')}>
            {t('לספרייה', lang)}
          </Btn>
          <Btn variant="tonal" onClick={() => openSearch()}>
            {t('חיפוש', lang)}
          </Btn>
        </div>
      </EmptyState>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-end bg-surface-1">
        <div ref={stripRef} className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto px-1 pt-1.5" style={{ scrollbarWidth: 'thin' }}>
          {tabs.map((t) => {
            const isActive = active?.id === t.id;
            return (
              <div
                key={t.id}
                data-tab={t.id}
                onMouseDown={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    closeTab(t.id);
                  }
                }}
                className={`group flex h-9 min-w-[120px] max-w-[220px] shrink-0 items-center gap-1 rounded-t-xl pr-3 pl-1 text-sm transition-colors ${
                  isActive ? 'bg-surface text-on-surface shadow-[0_-1px_0_var(--c-outline-variant)]' : 'text-on-variant hover:bg-surface-3'
                }`}
              >
                <button onClick={() => setActiveTab(t.id)} className="flex min-w-0 flex-1 items-center gap-2 text-start" title={t.kind === 'search' ? t.query : t.title}>
                  {t.kind === 'search' ? <SearchIcon size={15} className="shrink-0" /> : <BookOpen size={15} className="shrink-0" />}
                  <span className="truncate">{t.kind === 'search' ? `${lang === 'en' ? 'Search' : 'חיפוש'}${t.query ? `: ${t.query}` : ''}` : t.title}</span>
                </button>
                <button onClick={() => closeTab(t.id)} className="rounded-full p-1 text-on-variant opacity-70 hover:bg-surface-3 hover:opacity-100" aria-label="סגור לשונית">
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {tabs.map((tab) => (
          <div key={tab.id} className={tab.id === active?.id ? 'h-full min-h-0' : 'hidden'}>
            {tab.kind === 'book' ? <BookViewer tab={tab} /> : <SearchTabView tab={tab} />}
          </div>
        ))}
      </div>
    </div>
  );
}
