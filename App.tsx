import { AppProvider, useApp } from './store';
import NavRail from './components/NavRail';
import LibraryBrowser from './components/LibraryBrowser';
import ReadingScreen from './components/ReadingScreen';
import MoreScreen from './components/MoreScreen';
import SettingsScreen from './components/SettingsScreen';
import FindScreen from './components/FindScreen';
import { AboutDialog } from './components/Dialogs';
import DailyNotifications from './components/DailyNotifications';

function Shell() {
  const { screen, dialog, toastMsg } = useApp();

  // keep screens mounted so state (scroll positions, search text) is preserved
  const show = (s: string) => (screen === s ? 'h-full' : 'hidden');
  return (
    <div className="flex h-full flex-col-reverse bg-surface text-on-surface md:flex-row">
      <DailyNotifications />
      <NavRail />
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
      </main>
      {dialog === 'about' && <AboutDialog />}
      {toastMsg && (
        <div className="fade-in fixed bottom-20 right-1/2 z-[60] translate-x-1/2 rounded-xl bg-on-surface px-5 py-3 text-sm text-surface shadow-lg md:bottom-6">
          {toastMsg}
        </div>
      )}
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
