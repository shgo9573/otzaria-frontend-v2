import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, BookOpen, Clock3, Home, LogOut, Mail, RefreshCw, Search,
  Server, ShieldCheck, UserRound, UsersRound, Eye, MousePointerClick,
} from 'lucide-react';
import { api } from '../api';
import { useApp } from '../store';
import { Btn, EmptyState, Spinner } from './ui';

const KEY_STORAGE = 'otz_admin_key';

interface StatsShape {
  totalRequests?: number; requests?: number; totalVisits?: number; visits?: number;
  uniqueVisitors?: number; visitors?: number; uniqueUsers?: number;
  totalBooks?: number; books?: number;
  popularBooks?: Array<{ title?: string; bookTitle?: string; name?: string; count?: number; views?: number; hits?: number }>;
  popularSearches?: Array<{ query?: string; text?: string; count?: number; hits?: number }>;
  byHour?: Array<{ hour?: number | string; label?: string; count?: number; requests?: number }>;
  byDay?: Array<{ day?: string; date?: string; label?: string; count?: number; requests?: number; visitors?: number }>;
  [k: string]: unknown;
}

interface AdminUser {
  email?: string | null; userId?: string; uid?: string; id?: string | number;
  createdAt?: string; created_at?: string; registeredAt?: string;
  lastSeen?: string; lastActive?: string;
  [k: string]: unknown;
}

interface LogRow {
  time?: string; timestamp?: string; createdAt?: string;
  method?: string; path?: string; url?: string; message?: string; msg?: string;
  status?: number; statusCode?: number; ip?: string; user?: string;
  [k: string]: unknown;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function fmtDate(v: unknown): string {
  if (!v) return '—';
  const d = new Date(String(v));
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' });
}
function timeAgo(v: unknown): string {
  if (!v) return '';
  const d = new Date(String(v)).getTime();
  if (!isFinite(d)) return '';
  const m = Math.floor((Date.now() - d) / 60000);
  if (m < 1) return 'עכשיו';
  if (m < 60) return `לפני ${m} דק׳`;
  const h = Math.floor(m / 60);
  if (h < 24) return `לפני ${h} שע׳`;
  return `לפני ${Math.floor(h / 24)} ימים`;
}

function StatCard({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub?: string; tone: string }) {
  return (
    <div className="flex items-center gap-3 rounded-3xl border border-outline-variant bg-surface-1 p-4">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${tone}`}>{icon}</div>
      <div className="min-w-0">
        <div className="text-2xl font-bold leading-none tabular-nums">{value}</div>
        <div className="mt-1 text-sm text-on-variant">{label}</div>
        {sub && <div className="text-xs text-on-variant opacity-75">{sub}</div>}
      </div>
    </div>
  );
}

function Bars({ rows, color }: { rows: { label: string; value: number }[]; color: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="flex h-36 items-end gap-1" dir="ltr">
      {rows.map((r, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${r.label}: ${r.value}`}>
          <div className="flex w-full flex-1 items-end rounded-t-md bg-surface-3/60">
            <div className={`w-full rounded-t-md ${color}`} style={{ height: `${Math.max(3, (r.value / max) * 100)}%` }} />
          </div>
          <div className="w-full truncate text-center text-[10px] text-on-variant">{r.label}</div>
        </div>
      ))}
    </div>
  );
}

export default function AdminStats() {
  const { setScreen } = useApp();
  const [key, setKey] = useState<string>(() => {
    try { return sessionStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; }
  });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<StatsShape | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [tab, setTab] = useState<'overview' | 'users' | 'logs'>('overview');
  const [userQuery, setUserQuery] = useState('');

  const authed = !!key;

  const login = async () => {
    const c = code.trim();
    if (!c) return;
    setBusy(true);
    setErr('');
    try {
      const r = await api.adminVerify(c);
      if (!r.ok) throw new Error('קוד שגוי');
      try { sessionStorage.setItem(KEY_STORAGE, r.key); } catch { /* ignore */ }
      setKey(r.key);
      setCode('');
    } catch (e) {
      setErr((e as Error).message || 'אימות נכשל');
    } finally {
      setBusy(false);
    }
  };

  const logout = () => {
    try { sessionStorage.removeItem(KEY_STORAGE); } catch { /* ignore */ }
    setKey('');
    setStats(null);
    setUsers([]);
    setLogs([]);
  };

  const loadAll = useCallback(async () => {
    if (!key) return;
    setLoading(true);
    setErr('');
    try {
      const [s, u, l] = await Promise.all([
        api.adminFetch<any>(`/admin/stats?days=${days}`, key),
        api.adminFetch<any>('/admin/users', key).catch(() => null),
        api.adminFetch<any>('/admin/logs?limit=50', key).catch(() => null),
      ]);
      setStats((s?.stats || s?.data || s) as StatsShape);
      const ulist = Array.isArray(u) ? u : u?.users || u?.data || [];
      setUsers(Array.isArray(ulist) ? ulist : []);
      const llist = Array.isArray(l) ? l : l?.logs || l?.data || [];
      setLogs(Array.isArray(llist) ? llist : []);
    } catch (e) {
      const msg = (e as Error).message || 'שגיאה בטעינה';
      setErr(msg);
      if ((e as Error & { status?: number }).status === 401 || (e as Error & { status?: number }).status === 403) logout();
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, days]);

  useEffect(() => {
    if (key) loadAll();
  }, [key, loadAll]);

  const summary = useMemo(() => {
    if (!stats) return null;
    const requests = num(stats.totalRequests ?? stats.requests ?? stats.totalVisits ?? stats.visits);
    const visitors = num(stats.uniqueVisitors ?? stats.visitors ?? stats.uniqueUsers);
    const books = num(stats.totalBooks ?? stats.books);
    const usersCount = users.length;
    return { requests, visitors, books, usersCount };
  }, [stats, users]);

  const popularBooks = useMemo(() => {
    const arr = stats?.popularBooks || (stats as any)?.topBooks || [];
    return (Array.isArray(arr) ? arr : []).slice(0, 8).map((b) => ({
      title: str(b.title || b.bookTitle || b.name) || '—',
      count: num(b.count ?? b.views ?? b.hits),
    }));
  }, [stats]);

  const popularSearches = useMemo(() => {
    const arr = stats?.popularSearches || (stats as any)?.topSearches || [];
    return (Array.isArray(arr) ? arr : []).slice(0, 8).map((s) => ({
      title: str(s.query || s.text) || '—',
      count: num(s.count ?? s.hits),
    }));
  }, [stats]);

  const byHour = useMemo(() => {
    const arr = stats?.byHour || (stats as any)?.hourly || [];
    if (!Array.isArray(arr)) return [] as { label: string; value: number }[];
    return arr.slice(-24).map((h: any, i: number) => ({
      label: str(h.label ?? h.hour ?? i),
      value: num(h.count ?? h.requests ?? h.value),
    }));
  }, [stats]);

  const byDay = useMemo(() => {
    const arr = stats?.byDay || (stats as any)?.daily || [];
    if (!Array.isArray(arr)) return [] as { label: string; value: number }[];
    return arr.slice(-14).map((d: any) => ({
      label: str(d.label || d.day || d.date).slice(5) || str(d.label || d.day || d.date),
      value: num(d.count ?? d.requests ?? d.value ?? d.visitors),
    }));
  }, [stats]);

  const filteredUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      [u.email, u.userId, u.uid, u.id].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [users, userQuery]);

  if (!authed) {
    return (
      <div className="flex h-full items-center justify-center bg-surface p-6">
        <div className="w-full max-w-sm rounded-[28px] border border-outline-variant bg-surface-1 p-6 text-center shadow-xl">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-container text-on-primary-container">
            <ShieldCheck size={28} />
          </div>
          <h1 className="mb-1 text-xl font-bold">אזור ניהול</h1>
          <p className="mb-4 text-sm text-on-variant">הזינו את קוד המנהל כדי לצפות בסטטיסטיקות</p>
          <input
            type="password"
            dir="ltr"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && login()}
            placeholder="••••"
            autoFocus
            className="mb-3 h-12 w-full rounded-2xl border border-outline bg-surface px-4 text-center text-lg tracking-[0.5em] outline-none focus:border-primary"
          />
          {err && <div className="mb-3 text-sm text-error">{err}</div>}
          <Btn variant="filled" className="w-full" onClick={login} disabled={busy || !code.trim()}>
            {busy ? 'בודק…' : 'כניסה'}
          </Btn>
          <button onClick={() => setScreen('library')} className="mt-3 inline-flex items-center gap-1 text-sm text-on-variant hover:text-primary">
            <Home size={15} /> חזרה לאתר
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-container text-on-primary-container">
            <Activity size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold leading-tight">ניהול וסטטיסטיקות</h1>
            <div className="text-xs text-on-variant">נתוני שימוש מהשרת · מתעדכן בכל טעינה</div>
          </div>
          <div className="flex items-center gap-1 rounded-full bg-surface-1 p-1">
            {[7, 30].map((d) => (
              <button key={d} onClick={() => setDays(d)} className={`rounded-full px-3 py-1 text-xs ${days === d ? 'bg-sec-container font-medium text-on-sec-container' : 'text-on-variant'}`}>
                {d} ימים
              </button>
            ))}
          </div>
          <button onClick={loadAll} className="rounded-full p-2 text-on-variant hover:bg-surface-3" title="רענן">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={logout} className="rounded-full p-2 text-on-variant hover:bg-surface-3 hover:text-error" title="יציאה">
            <LogOut size={18} />
          </button>
          <button onClick={() => setScreen('library')} className="rounded-full p-2 text-on-variant hover:bg-surface-3" title="חזרה לאתר">
            <Home size={18} />
          </button>
        </div>

        {loading && !stats && <Spinner label="טוען נתונים מהשרת…" />}
        {err && (
          <div className="mb-4 rounded-2xl border border-outline-variant bg-surface-1 p-4 text-sm text-error">
            {err}
            <button onClick={() => { setErr(''); loadAll(); }} className="mr-2 underline">נסה שוב</button>
          </div>
        )}

        {stats && summary && (
          <>
            <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard icon={<MousePointerClick size={22} />} label="בקשות" value={summary.requests.toLocaleString('he-IL')} sub={`ב־${days} הימים האחרונים`} tone="bg-blue-500/15 text-blue-600 dark:text-blue-300" />
              <StatCard icon={<Eye size={22} />} label="מבקרים ייחודיים" value={summary.visitors.toLocaleString('he-IL')} sub="לפי מזהה דפדפן" tone="bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" />
              <StatCard icon={<UsersRound size={22} />} label="משתמשים רשומים" value={summary.usersCount.toLocaleString('he-IL')} sub="עם אימייל משויך" tone="bg-violet-500/15 text-violet-600 dark:text-violet-300" />
              <StatCard icon={<BookOpen size={22} />} label="ספרים" value={summary.books ? summary.books.toLocaleString('he-IL') : '—'} sub="בקטלוג" tone="bg-amber-500/15 text-amber-600 dark:text-amber-300" />
            </div>

            <div className="mb-5 flex gap-1 rounded-full bg-surface-1 p-1">
              {(
                [
                  ['overview', 'סקירה'],
                  ['users', `משתמשים (${users.length})`],
                  ['logs', 'יומן שרת'],
                ] as const
              ).map(([k, label]) => (
                <button key={k} onClick={() => setTab(k)} className={`flex-1 rounded-full py-2 text-sm ${tab === k ? 'bg-sec-container font-medium text-on-sec-container' : 'text-on-variant'}`}>
                  {label}
                </button>
              ))}
            </div>

            {tab === 'overview' && (
              <div className="space-y-4">
                {byDay.length > 0 && (
                  <div className="rounded-3xl border border-outline-variant bg-surface-1 p-5">
                    <div className="mb-3 flex items-center gap-2 text-sm font-bold"><Clock3 size={16} /> פעילות לפי ימים</div>
                    <Bars rows={byDay} color="bg-primary" />
                  </div>
                )}
                {byHour.length > 0 && (
                  <div className="rounded-3xl border border-outline-variant bg-surface-1 p-5">
                    <div className="mb-3 flex items-center gap-2 text-sm font-bold"><Clock3 size={16} /> פעילות לפי שעות</div>
                    <Bars rows={byHour} color="bg-emerald-500" />
                  </div>
                )}
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-3xl border border-outline-variant bg-surface-1 p-5">
                    <div className="mb-3 flex items-center gap-2 text-sm font-bold"><BookOpen size={16} /> ספרים פופולריים</div>
                    {popularBooks.length === 0 && <div className="text-sm text-on-variant">אין נתונים עדיין</div>}
                    {popularBooks.map((b, i) => (
                      <div key={i} className="mb-2 flex items-center gap-2 text-sm">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-container text-xs font-bold text-on-primary-container">{i + 1}</span>
                        <span className="min-w-0 flex-1 truncate">{b.title}</span>
                        <span className="tabular-nums text-on-variant">{b.count.toLocaleString('he-IL')}</span>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-3xl border border-outline-variant bg-surface-1 p-5">
                    <div className="mb-3 flex items-center gap-2 text-sm font-bold"><Search size={16} /> חיפושים פופולריים</div>
                    {popularSearches.length === 0 && <div className="text-sm text-on-variant">אין נתונים עדיין</div>}
                    {popularSearches.map((s, i) => (
                      <div key={i} className="mb-2 flex items-center gap-2 text-sm">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-container text-xs font-bold text-on-primary-container">{i + 1}</span>
                        <span className="min-w-0 flex-1 truncate" dir="auto">{s.title}</span>
                        <span className="tabular-nums text-on-variant">{s.count.toLocaleString('he-IL')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {tab === 'users' && (
              <div className="rounded-3xl border border-outline-variant bg-surface-1 p-5">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2 text-sm font-bold"><UsersRound size={16} /> משתמשים רשומים ({filteredUsers.length})</div>
                  <input
                    value={userQuery}
                    onChange={(e) => setUserQuery(e.target.value)}
                    placeholder="חיפוש לפי אימייל או מזהה…"
                    className="mr-auto h-9 w-56 max-w-full rounded-xl border border-outline bg-surface px-3 text-sm outline-none focus:border-primary"
                  />
                </div>
                {filteredUsers.length === 0 ? (
                  <EmptyState icon={<UserRound size={44} />} title="אין משתמשים להצגה" />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-sm">
                      <thead>
                        <tr className="border-b border-outline-variant text-start text-xs text-on-variant">
                          <th className="p-2 text-start font-medium">אימייל</th>
                          <th className="p-2 text-start font-medium">מזהה</th>
                          <th className="p-2 text-start font-medium">נרשם</th>
                          <th className="p-2 text-start font-medium">פעילות אחרונה</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredUsers.map((u, i) => (
                          <tr key={String(u.userId || u.uid || u.id || i)} className="border-b border-outline-variant/40 last:border-0">
                            <td className="p-2">
                              <span className="inline-flex items-center gap-1.5" dir="ltr">
                                <Mail size={14} className="text-on-variant" />
                                {str(u.email) || <span className="text-on-variant">—</span>}
                              </span>
                            </td>
                            <td className="p-2 font-mono text-xs text-on-variant" dir="ltr">{str(u.userId || u.uid || u.id).slice(0, 13)}…</td>
                            <td className="p-2 text-xs">{fmtDate(u.createdAt || u.created_at || u.registeredAt)}</td>
                            <td className="p-2 text-xs text-on-variant">{timeAgo(u.lastSeen || u.lastActive) || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {tab === 'logs' && (
              <div className="rounded-3xl border border-outline-variant bg-surface-1 p-5">
                <div className="mb-3 flex items-center gap-2 text-sm font-bold"><Server size={16} /> יומן שרת אחרון ({logs.length})</div>
                {logs.length === 0 && <div className="text-sm text-on-variant">אין רשומות יומן</div>}
                <div className="space-y-1.5 font-mono text-xs" dir="ltr">
                  {logs.map((l, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2/60 px-3 py-1.5">
                      <span className="text-on-variant">{fmtDate(l.time || l.timestamp || l.createdAt)}</span>
                      {str(l.method) && <span className="rounded bg-primary-container px-1.5 py-0.5 font-bold text-on-primary-container">{str(l.method)}</span>}
                      <span className="min-w-0 flex-1 truncate">{str(l.path || l.url || l.message || l.msg)}</span>
                      {(l.status || l.statusCode) && (
                        <span className={`rounded px-1.5 py-0.5 ${Number(l.status || l.statusCode) >= 400 ? 'bg-red-500/15 text-red-500' : 'bg-emerald-500/15 text-emerald-600'}`}>
                          {str(l.status || l.statusCode)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
