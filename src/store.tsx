import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, getUid } from './api';
import { buildLibrary, type Library } from './utils/library';
import { parseDeepLink } from './utils/text';
import { applyTheme } from './utils/theme';
import { currentAccount, logout as authLogout, type Account } from './auth';

type BookRef = { id: ID; title: string; categoryPath?: string };
import {
  DEFAULT_SETTINGS,
  type BookItem,
  type BookmarkItem,
  type BookTab,
  type Highlight,
  type ID,
  type PersonalNote,
  type ReaderSettings,
  type RecentSearchItem,
  type ReadingHistoryItem,
  type Screen,
  type SearchTab,
  type Tab,
} from './types';

interface Ctx {
  screen: Screen;
  setScreen: (s: Screen) => void;
  library: Library | null;
  libraryLoading: boolean;
  libraryError: string;
  reloadLibrary: () => void;

  settings: ReaderSettings;
  updateSettings: (p: Partial<ReaderSettings>) => void;
  resetSettings: () => Promise<void>;

  tabs: Tab[];
  activeTabId: string | null;
  setActiveTab: (id: string) => void;
  closeTab: (id: string) => void;
  updateTab: (id: string, patch: Partial<BookTab> | Partial<SearchTab>) => void;
  openBook: (ref: BookRef, line?: number, highlight?: Highlight) => void;
  openBookInNewTab: (ref: BookRef, line?: number, highlight?: Highlight) => void;
  openBookInActiveTab: (ref: BookRef, line?: number) => void;
  removeHistoryItem: (item: ReadingHistoryItem) => Promise<void>;
  notes: PersonalNote[];
  saveNote: (n: Omit<PersonalNote, 'id' | 'updatedAt'> & { id?: string }) => void;
  deleteNote: (id: string) => void;
  openBookByTitle: (title: string, line?: number) => void;
  openSearch: (query?: string) => void;
  recentSearches: RecentSearchItem[];
  recordSearch: (query: string) => void;
  removeRecentSearch: (query: string) => void;
  clearRecentSearches: () => void;

  bookmarks: BookmarkItem[];
  history: ReadingHistoryItem[];
  refreshUser: () => Promise<void>;
  addBookmark: (b: Partial<BookmarkItem>) => Promise<void>;
  removeBookmark: (id: string) => Promise<void>;
  saveHistory: (h: Partial<ReadingHistoryItem>) => void;
  clearHistory: () => Promise<void>;
  setBookmarks: (b: BookmarkItem[]) => void;
  setHistory: (h: ReadingHistoryItem[]) => void;

  account: Account | null;
  setAccount: (a: Account | null) => void;
  signOut: () => void;

  toast: (msg: string) => void;
  toastMsg: string;
  dialog: null | 'about';
  setDialog: (d: null | 'about') => void;
}

const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

let tabCounter = Date.now();
const newTabId = () => 't' + tabCounter++;

export function AppProvider({ children }: { children: ReactNode }) {
  // Parse the link inside the provider (not at module evaluation) so it works
  // with client-side navigation, wrappers and every browser startup order.
  const [linkedTab] = useState<BookTab | null>(() => {
    const d = typeof window === 'undefined' ? null : parseDeepLink();
    if (!d) return null;
    return {
      id: newTabId(),
      kind: 'book',
      bookId: /^\d+$/.test(d.book) ? Number(d.book) : d.book,
      title: d.book,
      line: d.line,
      highlight: d.from !== undefined ? { line: d.line, from: d.from, to: d.to } : d.text ? { line: d.line, text: d.text } : undefined,
    };
  });
  const [screen, setScreenState] = useState<Screen>(() => {
    try {
      const p = window.location.pathname || '';
      const h = window.location.hash || '';
      if (p.replace(/\/$/, '').endsWith('/admin') || h.includes('admin')) return 'admin';
    } catch { /* ignore */ }
    return linkedTab ? 'reading' : load<Screen>('otz_screen', 'library');
  });
  const [library, setLibrary] = useState<Library | null>(null);
  // when opened from a direct link we skip the (large) catalogue download until it is actually needed
  const [libraryLoading, setLibraryLoading] = useState(!linkedTab);
  const [libraryError, setLibraryError] = useState('');
  const [settings, setSettings] = useState<ReaderSettings>(() => ({ ...DEFAULT_SETTINGS, ...load<Partial<ReaderSettings>>('otz_settings', {}) }));
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const saved = load<Tab[]>('otz_tabs', []);
    if (!linkedTab) return saved;
    return [...saved.filter((t) => !(t.kind === 'book' && String(t.bookId) === String(linkedTab.bookId))), linkedTab];
  });
  const [activeTabId, setActiveTabId] = useState<string | null>(() => linkedTab?.id ?? load<string | null>('otz_active', null));
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [history, setHistory] = useState<ReadingHistoryItem[]>([]);
  const recentSearchKey = useRef(`otz_recent_searches:${getUid()}`).current;
  const [recentSearches, setRecentSearches] = useState<RecentSearchItem[]>(() => load(recentSearchKey, []));
  const [toastMsg, setToastMsg] = useState('');
  const [account, setAccount] = useState<Account | null>(() => currentAccount());
  const [dialog, setDialog] = useState<null | 'about'>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const saveTimer = useRef<number | undefined>(undefined);
  const histRef = useRef<ReadingHistoryItem[]>([]);
  histRef.current = history;
  const libRef = useRef<Library | null>(null);
  libRef.current = library;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabRef = useRef(activeTabId);
  activeTabRef.current = activeTabId;

  const setScreen = useCallback((s: Screen) => {
    setScreenState(s);
    // the hidden admin screen is never persisted – it only opens via /admin
    if (s !== 'admin') save('otz_screen', s);
    try {
      const onAdmin = (window.location.pathname || '').replace(/\/$/, '').endsWith('/admin');
      if (s === 'admin' && !onAdmin) window.history.pushState(null, '', '/admin');
      else if (s !== 'admin' && onAdmin) window.history.pushState(null, '', '/');
    } catch { /* ignore */ }
  }, []);

  // theme + seed colour + brightness
  useEffect(() => {
    applyTheme(settings.theme, settings.seedColor, Number(settings.uiBrightness) || 0);
  }, [settings.theme, settings.seedColor, settings.uiBrightness]);

  useEffect(() => {
    document.documentElement.lang = settings.interfaceLanguage === 'en' ? 'en' : 'he';
    document.documentElement.dir = settings.interfaceLanguage === 'en' ? 'ltr' : 'rtl';
  }, [settings.interfaceLanguage]);

  useEffect(() => save('otz_tabs', tabs), [tabs]);
  useEffect(() => save('otz_active', activeTabId), [activeTabId]);

  // when all tabs are closed, go back to the library
  const prevTabCount = useRef(tabs.length);
  useEffect(() => {
    if (prevTabCount.current > 0 && tabs.length === 0 && screen === 'reading') setScreen('library');
    prevTabCount.current = tabs.length;
  }, [tabs.length, screen, setScreen]);
  useEffect(() => save(recentSearchKey, recentSearches), [recentSearchKey, recentSearches]);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(''), 3000);
  }, []);

  const libraryPromise = useRef<Promise<Library | null> | null>(null);
  const loadLibrary = useCallback(() => {
    setLibraryLoading(true);
    setLibraryError('');
    const p = api
      .libraryTree()
      .then((d) => {
        const lib = buildLibrary(d);
        setLibrary(lib);
        return lib;
      })
      .catch((e) => {
        setLibraryError(e?.message || 'לא ניתן להתחבר לשרת');
        libraryPromise.current = null;
        return null;
      })
      .finally(() => setLibraryLoading(false));
    libraryPromise.current = p;
    return p;
  }, []);
  /** Loads the catalogue once, on demand. */
  const ensureLibrary = useCallback((): Promise<Library | null> => {
    if (libRef.current) return Promise.resolve(libRef.current);
    return libraryPromise.current ?? loadLibrary();
  }, [loadLibrary]);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const refreshUser = useCallback(async () => {
    try {
      const [b, h] = await Promise.all([api.bookmarks(), api.history()]);
      const hidden = new Set(settingsRef.current.hiddenHistoryIds || []);
      setBookmarks(b);
      setHistory(h.filter((x) => !hidden.has(x.id)));
    } catch {
      /* offline */
    }
  }, []);

  useEffect(() => {
    if (!linkedTab) loadLibrary();
    refreshUser();
    api
      .getSettings()
      .then((s) => {
        if (s && Object.keys(s).length) {
          setSettings((prev) => {
            const next = { ...prev, ...s } as ReaderSettings;
            save('otz_settings', next);
            return next;
          });
        }
      })
      .catch(() => undefined);
  }, [loadLibrary, refreshUser]);

  // opened from a link: fetch the catalogue only once the user leaves the reader
  useEffect(() => {
    if (!library && screen !== 'reading') ensureLibrary();
  }, [screen, library, ensureLibrary]);

  useEffect(() => {
    if (!library) return;
    setTabs((current) => current.map((tab) => {
      if (tab.kind !== 'book') return tab;
      const book = library.byId.get(String(tab.bookId));
      return book && (book.title !== tab.title || book.categoryPath !== tab.category)
        ? { ...tab, title: book.title, category: book.categoryPath }
        : tab;
    }));
  }, [library]);

  const updateSettings = useCallback((p: Partial<ReaderSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...p };
      save('otz_settings', next);
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        api.saveSettings(next).catch(() => undefined);
      }, 800);
      return next;
    });
  }, []);

  const resetSettings = useCallback(async () => {
    setSettings({ ...DEFAULT_SETTINGS });
    save('otz_settings', DEFAULT_SETTINGS);
    try {
      await api.resetSettings();
    } catch {
      /* ignore */
    }
  }, []);

  // tabs
  const setActiveTab = useCallback((id: string) => {
    setActiveTabId(id);
    setScreen('reading');
  }, [setScreen]);

  const closeTab = useCallback((id: string) => {
    const cur = tabsRef.current;
    const idx = cur.findIndex((t) => t.id === id);
    const next = cur.filter((t) => t.id !== id);
    setTabs(next);
    setActiveTabId((a) => (a === id ? next[Math.min(idx, next.length - 1)]?.id ?? null : a));
  }, []);

  const updateTab = useCallback((id: string, patch: Partial<BookTab> | Partial<SearchTab>) => {
    setTabs((ts) => ts.map((t) => (t.id === id ? ({ ...t, ...patch } as Tab) : t)));
  }, []);

  const openBook = useCallback(
    (ref: BookRef, line?: number, highlight?: Highlight) => {
      const existing = tabsRef.current.find((t) => t.kind === 'book' && String(t.bookId) === String(ref.id)) as BookTab | undefined;
      if (existing) {
        if (line !== undefined) {
          updateTab(existing.id, { jump: { line, n: Date.now() }, highlight });
        } else if (highlight) {
          updateTab(existing.id, { highlight });
        }
        setActiveTabId(existing.id);
      } else {
        const h = histRef.current.find((x) => String(x.bookId) === String(ref.id));
        const start = line ?? h?.lastPosition ?? 1;
        const tab: BookTab = {
          id: newTabId(),
          kind: 'book',
          bookId: ref.id,
          title: ref.title,
          category: ref.categoryPath,
          line: start,
          highlight,
        };
        setTabs((ts) => [...ts, tab]);
        setActiveTabId(tab.id);
      }
      setScreen('reading');
    },
    [setScreen, updateTab],
  );

  const openBookInNewTab = useCallback(
    (ref: BookRef, line?: number, highlight?: Highlight) => {
      const h = histRef.current.find((x) => String(x.bookId) === String(ref.id));
      const tab: BookTab = {
        id: newTabId(),
        kind: 'book',
        bookId: ref.id,
        title: ref.title,
        category: ref.categoryPath,
        line: line ?? h?.lastPosition ?? 1,
        highlight,
      };
      setTabs((ts) => [...ts, tab]);
      setActiveTabId(tab.id);
      setScreen('reading');
    },
    [setScreen],
  );

  const openBookInActiveTab = useCallback(
    (ref: BookRef, line?: number) => {
      const current = activeTabRef.current ?? tabsRef.current[0]?.id;
      const id = current || newTabId();
      const h = histRef.current.find((x) => String(x.bookId) === String(ref.id));
      const tab: BookTab = {
        id,
        kind: 'book',
        bookId: ref.id,
        title: ref.title,
        category: ref.categoryPath,
        line: line ?? h?.lastPosition ?? 1,
      };
      setTabs((ts) => {
        const index = ts.findIndex((t) => t.id === id);
        if (index < 0) return [...ts, tab];
        return ts.map((t, i) => (i === index ? tab : t));
      });
      setActiveTabId(id);
      setScreen('reading');
    },
    [setScreen],
  );

  const openBookByTitle = useCallback(
    (title: string, line?: number) => {
      ensureLibrary().then((lib) => {
        let b: BookItem | undefined = lib?.byTitle.get(title);
        if (!b && lib) {
          const t = title.trim();
          b = lib.books.find((x) => x.title === t || x.title.includes(t));
        }
        if (b) openBook(b, line);
        else toast('הספר "' + title + '" לא נמצא בספרייה');
      });
    },
    [openBook, toast, ensureLibrary],
  );

  // a link pasted into an already-open tab only changes the fragment (no reload) – handle it live
  useEffect(() => {
    const onHash = () => {
      const d = parseDeepLink();
      if (!d) return;
      const bookId = /^\d+$/.test(d.book) ? Number(d.book) : d.book;
      const highlight: Highlight | undefined =
        d.from !== undefined ? { line: d.line, from: d.from, to: d.to } : d.text ? { line: d.line, text: d.text } : undefined;
      const known = libRef.current?.byId.get(String(bookId));
      openBook({ id: bookId, title: known?.title || d.book, categoryPath: known?.categoryPath }, d.line, highlight);
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onHash);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('popstate', onHash);
    };
  }, [openBook]);

  const openSearch = useCallback(
    (query?: string) => {
      const existing = tabsRef.current.find((t) => t.kind === 'search') as SearchTab | undefined;
      if (existing) {
        if (query !== undefined) updateTab(existing.id, { query });
        setActiveTabId(existing.id);
      } else {
        const tab: SearchTab = { id: newTabId(), kind: 'search', title: 'חיפוש', query: query ?? '' };
        setTabs((ts) => [...ts, tab]);
        setActiveTabId(tab.id);
      }
      setScreen('reading');
    },
    [setScreen, updateTab],
  );

  const recordSearch = useCallback((query: string) => {
    const q = query.trim();
    if (!q) return;
    setRecentSearches((current) => {
      const next = [
        { query: q, searchedAt: new Date().toISOString() },
        ...current.filter((x) => x.query.trim().toLocaleLowerCase() !== q.toLocaleLowerCase()),
      ].slice(0, 30);
      save(recentSearchKey, next);
      return next;
    });
  }, [recentSearchKey]);

  const removeRecentSearch = useCallback((query: string) => {
    setRecentSearches((current) => current.filter((x) => x.query !== query));
  }, []);

  const clearRecentSearches = useCallback(() => setRecentSearches([]), []);

  // notes (stored inside the user's settings object on the server + localStorage)
  const notes = useMemo(() => (Array.isArray(settings.personalNotes) ? settings.personalNotes : []), [settings.personalNotes]);
  const saveNote = useCallback(
    (n: Omit<PersonalNote, 'id' | 'updatedAt'> & { id?: string }) => {
      setSettings((prev) => {
        const cur = Array.isArray(prev.personalNotes) ? prev.personalNotes : [];
        const id = n.id || 'note_' + Date.now().toString(36);
        const item: PersonalNote = { ...n, id, updatedAt: new Date().toISOString() };
        const next = { ...prev, personalNotes: [item, ...cur.filter((x) => x.id !== id)] };
        save('otz_settings', next);
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => api.saveSettings(next).catch(() => undefined), 500);
        return next;
      });
    },
    [],
  );
  const deleteNote = useCallback((id: string) => {
    setSettings((prev) => {
      const cur = Array.isArray(prev.personalNotes) ? prev.personalNotes : [];
      const next = { ...prev, personalNotes: cur.filter((x) => x.id !== id) };
      save('otz_settings', next);
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => api.saveSettings(next).catch(() => undefined), 500);
      return next;
    });
  }, []);

  const removeHistoryItem = useCallback(
    async (item: ReadingHistoryItem) => {
      // optimistic local removal
      setHistory((h) => h.filter((x) => x.id !== item.id));
      try {
        const r = await api.deleteHistoryItem(item.id);
        if (r.history) setHistory(r.history);
      } catch {
        // no per-item endpoint on the server yet – remember it as hidden in the user's settings
        setSettings((prev) => {
          const hidden = Array.isArray(prev.hiddenHistoryIds) ? prev.hiddenHistoryIds : [];
          const next = { ...prev, hiddenHistoryIds: Array.from(new Set([...hidden, item.id, String(item.bookId)])) };
          save('otz_settings', next);
          api.saveSettings(next).catch(() => undefined);
          return next;
        });
      }
    },
    [],
  );

  const addBookmark = useCallback(
    async (b: Partial<BookmarkItem>) => {
      try {
        const r = await api.addBookmark(b);
        setBookmarks(r.bookmarks || []);
        toast('הסימניה נוספה');
      } catch (e) {
        toast((e as Error).message || 'שגיאה בהוספת סימניה');
      }
    },
    [toast],
  );

  const removeBookmark = useCallback(
    async (id: string) => {
      try {
        const r = await api.deleteBookmark(id);
        setBookmarks(r.bookmarks || []);
      } catch (e) {
        toast((e as Error).message);
      }
    },
    [toast],
  );

  const saveHistory = useCallback((h: Partial<ReadingHistoryItem>) => {
    api
      .saveHistory(h)
      .then((r) => {
        if (!r.history) return;
        const hidden = new Set(settingsRef.current.hiddenHistoryIds || []);
        // reading a book again un-hides it
        if (hidden.size && h.bookId !== undefined && hidden.has(String(h.bookId))) {
          setSettings((prev) => {
            const next = { ...prev, hiddenHistoryIds: (prev.hiddenHistoryIds || []).filter((x) => x !== String(h.bookId) && x !== r.item?.id) };
            save('otz_settings', next);
            return next;
          });
        }
        setHistory(r.history.filter((x) => !hidden.has(x.id) || String(x.bookId) === String(h.bookId)));
      })
      .catch(() => undefined);
  }, []);

  const clearHistory = useCallback(async () => {
    try {
      const r = await api.clearHistory();
      setHistory(r.history || []);
    } catch (e) {
      toast((e as Error).message);
    }
  }, [toast]);

  // when the signed-in user changes, pull that profile from the server
  const accountRef = useRef<string | null>(account?.uid ?? null);
  useEffect(() => {
    if (accountRef.current === (account?.uid ?? null)) return;
    accountRef.current = account?.uid ?? null;
    refreshUser();
    api
      .getSettings()
      .then((s) => {
        if (s && Object.keys(s).length) {
          setSettings((prev) => {
            const next = { ...DEFAULT_SETTINGS, ...prev, ...s } as ReaderSettings;
            save('otz_settings', next);
            return next;
          });
        }
      })
      .catch(() => undefined);
  }, [account?.uid, refreshUser]);

  const signOut = useCallback(() => {
    authLogout();
    setAccount(null);
    setBookmarks([]);
    setHistory([]);
    setSettings({ ...DEFAULT_SETTINGS });
    save('otz_settings', DEFAULT_SETTINGS);
    toast('התנתקת מהחשבון');
  }, [toast]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      const map: Record<string, () => void> = {
        l: () => setScreen('library'),
        r: () => setScreen('reading'),
        m: () => setScreen('more'),
        ',': () => setScreen('settings'),
        o: () => setScreen('find'),
        q: () => openSearch(),
        // hebrew keyboard fallbacks
        'ך': () => setScreen('library'),
        'ר': () => setScreen('reading'),
        'צ': () => setScreen('more'),
        'ם': () => setScreen('find'),
        '/': () => openSearch(),
      };
      const fn = map[k];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setScreen, openSearch]);

  const value = useMemo<Ctx>(
    () => ({
      screen, setScreen, library, libraryLoading, libraryError, reloadLibrary: loadLibrary,
      settings, updateSettings, resetSettings,
      tabs, activeTabId, setActiveTab, closeTab, updateTab, openBook, openBookInNewTab, openBookInActiveTab, openBookByTitle, openSearch,
      recentSearches, recordSearch, removeRecentSearch, clearRecentSearches,
      bookmarks, history, refreshUser, addBookmark, removeBookmark, saveHistory, clearHistory, setBookmarks, setHistory,
      removeHistoryItem, notes, saveNote, deleteNote,
      account, setAccount, signOut,
      toast, toastMsg, dialog, setDialog,
    }),
    [screen, setScreen, library, libraryLoading, libraryError, loadLibrary, settings, updateSettings, resetSettings, tabs, activeTabId, setActiveTab, closeTab, updateTab, openBook, openBookInNewTab, openBookInActiveTab, openBookByTitle, openSearch, recentSearches, recordSearch, removeRecentSearch, clearRecentSearches, bookmarks, history, refreshUser, addBookmark, removeBookmark, saveHistory, clearHistory, removeHistoryItem, notes, saveNote, deleteNote, account, signOut, toast, toastMsg, dialog],
  );

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
