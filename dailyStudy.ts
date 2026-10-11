import { HDate, HebrewCalendar, Location, Locale, Sedra, Zmanim } from '@hebcal/core';
import { DafYomi, MishnaYomiIndex } from '@hebcal/learning';
import { dailyRambam1 } from '@hebcal/learning/rambam1Base';
import { chofetzChaim } from '@hebcal/learning/chofetzChaimBase';
import { dirshuDafHalacha } from '@hebcal/learning/dirshuDafHalachaBase';
import { arukhHaShulchanYomi } from '@hebcal/learning/arukhHaShulchanYomiBase';
import { kitzurShulchanAruch } from '@hebcal/learning/kitzurShulchanAruchBase';

export interface DailyItem {
  key: string;
  label: string;
  value: string;
  bookHint?: string;
  lineHint?: number;
}

/** Hebrew date string for a given JS date. */
export function hebrewDate(d: Date): string {
  const hd = new HDate(d);
  return hd.renderGematriya();
}

export function dafYomiFor(d: Date): { name: string; blatt: number; label: string } | null {
  try {
    const daf = new DafYomi(d);
    return { name: daf.getName(), blatt: Number(daf.getBlatt()), label: daf.render('he') };
  } catch {
    return null;
  }
}

let mishnaIndex: MishnaYomiIndex | null = null;
export function mishnaYomiReadingsFor(d: Date): { k: string; v: string }[] {
  try {
    if (!mishnaIndex) mishnaIndex = new MishnaYomiIndex();
    return mishnaIndex.lookup(d);
  } catch {
    return [];
  }
}
export function mishnaYomiFor(d: Date): string | null {
  const pair = mishnaYomiReadingsFor(d);
  if (pair.length) {
    const fmt = (m: { k: string; v: string }) => `${Locale.gettext(m.k, 'he')} ${m.v}`;
    return pair.length > 1 ? `${fmt(pair[0])} – ${fmt(pair[pair.length - 1])}` : fmt(pair[0]);
  }
  return null;
}

export function parashaFor(d: Date): string | null {
  try {
    const hd = new HDate(d);
    const result = new Sedra(hd.getFullYear(), true).lookup(hd);
    if (result.chag || !result.parsha.length) return null;
    return `פרשת ${result.parsha.map((name) => Locale.gettext(name, 'he')).join('־')}`;
  } catch {
    return null;
  }
}

export function rambamReadingFor(d: Date): { name: string; perek: number | string } | null {
  try { return dailyRambam1(d); } catch { return null; }
}

export function rambamFor(d: Date): string {
  const r = rambamReadingFor(d);
  return r ? `${Locale.gettext(r.name, 'he')}, פרק ${r.perek}` : '—';
}

export function chofetzChaimReadingFor(d: Date) {
  try { return chofetzChaim(new HDate(d)); } catch { return null; }
}

const HEB = (n: number) => {
  const ones = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
  const tens = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
  if (n === 15) return 'ט״ו';
  if (n === 16) return 'ט״ז';
  const s = (n >= 100 ? 'ק' : '') + tens[Math.floor((n % 100) / 10)] + ones[n % 10];
  return s.length > 1 ? `${s.slice(0, -1)}״${s.slice(-1)}` : `${s}׳`;
};

/**
 * Today's portion of the worldwide Sefer Chofetz Chaim daily calendar (completed three times a year:
 * from א׳ תשרי, א׳ שבט and א׳ סיון). For example כלל א׳ סעיף א׳ is learned on כ״ו תשרי / כ״ה שבט / כ״ה סיון.
 */
export function chofetzChaimFor(d: Date): string {
  const r = chofetzChaimReadingFor(d);
  if (!r) return '—';
  const sections: Record<string, string> = {
    Hakdamah: 'הקדמה', Psichah: 'פתיחה', Lavin: 'לאוין', Asin: 'עשיין', Arurin: 'ארורין',
    HilchosLH: 'הלכות לשון הרע', HilchosRechilus: 'הלכות רכילות', Tziyurim: 'ציורים',
  };
  const name = sections[r.k] || 'חפץ חיים';
  const ends = (Array.isArray(r.e) ? r.e : [r.e]).filter((x) => x !== undefined && String(x) !== String(r.b));
  if (r.k === 'HilchosLH' || r.k === 'HilchosRechilus' || r.k === 'Tziyurim') {
    const [rule, para] = String(r.b).split('.').map(Number);
    const begin = para ? `כלל ${HEB(rule)} סעיף ${HEB(para)}` : `כלל ${HEB(rule)}`;
    const last = ends[ends.length - 1];
    if (last === undefined) return `${name}, ${begin}`;
    const [eRule, ePara] = String(last).split('.').map(Number);
    const end = eRule === rule ? `${HEB(ePara)}` : `כלל ${HEB(eRule)} סעיף ${HEB(ePara)}`;
    return `${name}, ${begin}–${end}`;
  }
  if (r.k === 'Arurin') return name;
  const b = Number(r.b);
  const last = ends.length ? Number(ends[ends.length - 1]) : NaN;
  return `${name} ${HEB(b)}${Number.isFinite(last) ? `–${HEB(last)}` : ''}`;
}

export function halachaYomitFor(d: Date, schedule: string = 'dirshu_mishna_berura'): string {
  try {
    if (schedule === 'kitzur_shulchan_aruch') {
      const r = kitzurShulchanAruch(d);
      return r ? `קיצור שולחן ערוך ${r.b}${r.e ? `–${r.e}` : ''}` : 'אין לימוד מתוזמן היום';
    }
    if (schedule === 'shulchan_aruch') {
      const r = arukhHaShulchanYomi(d);
      return `${Locale.gettext(r.k, 'he')} ${r.v}`;
    }
    if (schedule === 'rambam_halacha') {
      const r = dailyRambam1(d);
      return `${Locale.gettext(r.name, 'he')}, פרק ${r.perek}`;
    }
    const r = dirshuDafHalacha(d);
    if (!r) return 'אין מראה מקום זמין לתאריך זה';
    return `${r.review ? 'חזרה · ' : ''}משנה ברורה ${r.b}${r.e ? `–${r.e}` : ''}`;
  } catch {
    return 'אין מראה מקום זמין לתאריך זה';
  }
}

export interface ZmanimRow {
  key: string;
  label: string;
  time: string;
}

export const LOCATIONS: { id: string; label: string; lat: number; lon: number; tz: string; il: boolean }[] = [
  { id: 'jerusalem', label: 'ירושלים', lat: 31.7683, lon: 35.2137, tz: 'Asia/Jerusalem', il: true },
  { id: 'telaviv', label: 'תל אביב', lat: 32.0853, lon: 34.7818, tz: 'Asia/Jerusalem', il: true },
  { id: 'haifa', label: 'חיפה', lat: 32.794, lon: 34.9896, tz: 'Asia/Jerusalem', il: true },
  { id: 'beersheva', label: 'באר שבע', lat: 31.2518, lon: 34.7915, tz: 'Asia/Jerusalem', il: true },
  { id: 'bneibrak', label: 'בני ברק', lat: 32.0807, lon: 34.8338, tz: 'Asia/Jerusalem', il: true },
  { id: 'tsfat', label: 'צפת', lat: 32.9646, lon: 35.496, tz: 'Asia/Jerusalem', il: true },
  { id: 'newyork', label: 'ניו יורק', lat: 40.7128, lon: -74.006, tz: 'America/New_York', il: false },
  { id: 'london', label: 'לונדון', lat: 51.5074, lon: -0.1278, tz: 'Europe/London', il: false },
  { id: 'paris', label: 'פריז', lat: 48.8566, lon: 2.3522, tz: 'Europe/Paris', il: false },
];

export function zmanimFor(d: Date, locationId: string, method: 'gra' | 'mga' | 'baal_hatanya'): ZmanimRow[] {
  const loc = LOCATIONS.find((l) => l.id === locationId) ?? LOCATIONS[0];
  const location = new Location(loc.lat, loc.lon, loc.il, loc.tz, loc.label, loc.il ? 'IL' : undefined);
  const z = new Zmanim(location, d, false);
  const fmt = (t: Date | null | undefined) => {
    if (!t || isNaN(t.getTime())) return '—';
    return new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: loc.tz }).format(t);
  };
  const mga = method === 'mga';
  const rows: ZmanimRow[] = [
    { key: 'alot', label: 'עלות השחר', time: fmt(z.alotHaShachar()) },
    { key: 'talit', label: 'טלית ותפילין', time: fmt(z.misheyakir()) },
    { key: 'sunrise', label: 'הנץ החמה', time: fmt(z.sunrise()) },
    { key: 'shma', label: mga ? 'סוף זמן ק"ש (מג"א)' : 'סוף זמן ק"ש (גר"א)', time: fmt(mga ? z.sofZmanShmaMGA() : z.sofZmanShma()) },
    { key: 'tfila', label: mga ? 'סוף זמן תפילה (מג"א)' : 'סוף זמן תפילה (גר"א)', time: fmt(mga ? z.sofZmanTfillaMGA() : z.sofZmanTfilla()) },
    { key: 'chatzot', label: 'חצות היום', time: fmt(z.chatzot()) },
    { key: 'mincha-g', label: 'מנחה גדולה', time: fmt(z.minchaGedola()) },
    { key: 'mincha-k', label: 'מנחה קטנה', time: fmt(z.minchaKetana()) },
    { key: 'plag', label: 'פלג המנחה', time: fmt(z.plagHaMincha()) },
    { key: 'sunset', label: 'שקיעה', time: fmt(z.sunset()) },
    { key: 'tzeit', label: 'צאת הכוכבים', time: fmt(z.tzeit(8.5)) },
  ];
  return rows;
}

export function holidaysFor(d: Date): string[] {
  try {
    const events = HebrewCalendar.calendar({ start: d, end: d, il: true, locale: 'he', candlelighting: false });
    return events.map((e) => e.render('he'));
  } catch {
    return [];
  }
}
