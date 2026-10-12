import { useEffect } from 'react';
import { AppProvider, useApp } from './store';
import NavRail from './components/NavRail';
import LibraryBrowser from './components/LibraryBrowser';
import ReadingScreen from './components/ReadingScreen';
import MoreScreen from './components/MoreScreen';
import SettingsScreen from './components/SettingsScreen';
import FindScreen from './components/FindScreen';
import AdminStats from './components/AdminStats';
import { AboutDialog } from './components/Dialogs';
import DailyNotifications from './components/DailyNotifications';

function Shell() {
  const { screen, dialog, toastMsg, setScreen } = useApp();

  // typing /admin in the address bar (back/forward included) opens the hidden admin screen
  useEffect(() => {
    const onAdminPath = () => {
      try {
        const onAdmin = (window.location.pathname || '').replace(/\/$/, '').endsWith('/admin');
        if (onAdmin) setScreen('admin');
        else if ((window as unknown as { __lastScreen?: string }).__lastScreen === 'admin') setScreen('library');
      } catch { /* ignore */ }
    };
    onAdminPath();
    window.addEventListener('popstate', onAdminPath);
    return () => window.removeEventListener('popstate', onAdminPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try { (window as unknown as { __lastScreen?: string }).__lastScreen = screen; } catch { /* ignore */ }
  }, [screen]);

  // keep screens mounted so state (scroll positions, search text) is preserved
  const show = (s: string) => (screen === s ? 'h-full' : 'hidden');
  return (
    <div className="flex h-full flex-col-reverse bg-surface text-on-surface md:flex-row">
      <DailyNotifications />
      {screen !== 'admin' && <NavRail />}
      <main className="relative min-h-0 min-w-0 flex-1">
        <div className={show('library')}>
          <LibraryBrowser />
        </div>
        <div className={show('reading')}>
          <ReadingScreen />
        </div>
        <div className={show('find')}>{screen === 'find' && <FindScreen />}</div>
        <div className={show('more')}>{screen === 'more' && <MoreScreen />}</div>
        <div className={show('settings')}>{screen === 'settings' && <SettingsScreen />}</div>
        <div className={show('admin')}>{screen === 'admin' && <AdminStats />}</div>
      </main>
      {dialog === 'about' && <AboutDialog />}
      {toastMsg && (
        <div className="fade-in fixed bottom-20 right-1/2 z-[60] translate-x-1/2 rounded-xl bg-on-surface px-5 py-3 text-sm text-surface shadow-lg md:bottom-6">
          {toastMsg}
        </div>
      )}
      <div
        className="pointer-events-none fixed bottom-16 right-3 z-[55] max-w-[calc(100vw-1.5rem)] rounded-lg border border-black/10 bg-white/95 px-3 py-1.5 text-[11px] leading-4 text-gray-700 shadow-md backdrop-blur md:bottom-3 dark:border-white/15 dark:bg-gray-900/95 dark:text-gray-200"
        role="status"
        aria-label="הודעת מצב האתר"
        dir="rtl"
      >
        האתר בפיתוח, ייתכנו שיבושים
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
