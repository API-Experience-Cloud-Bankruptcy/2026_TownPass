import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import type { Category, Identity, Profile } from '../data/welfare-schema';
import type { Origin } from './nearby';

export type FontLevel = 'standard' | 'large' | 'xlarge';
export const FONT_SCALE: Record<FontLevel, number> = { standard: 1, large: 1.2, xlarge: 1.45 };

export interface Palette {
  bg: string;
  surface: string;
  sunken: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  accentText: string;
  accentSoft: string;
  focus: string;
}

const NORMAL: Palette = {
  bg: '#F7F4EE',
  surface: '#FFFFFF',
  sunken: '#EFEBE3',
  text: '#1D2321',
  muted: '#55605C',
  border: '#DDD6CA',
  accent: '#0D6B5E',
  accentText: '#FFFFFF',
  accentSoft: '#E1EFEB',
  focus: '#0D6B5E',
};

const HIGH_CONTRAST: Palette = {
  bg: '#FFFFFF',
  surface: '#FFFFFF',
  sunken: '#F2F2F2',
  text: '#000000',
  muted: '#1A1A1A',
  border: '#000000',
  accent: '#003D35',
  accentText: '#FFFFFF',
  accentSoft: '#D6EDE7',
  focus: '#000000',
};

interface Settings {
  fontLevel: FontLevel;
  highContrast: boolean;
}

export interface Answers {
  profile: Profile;
  /** Identities the person skipped answering about. */
  unknownIdentities: Identity[];
  /** Ids of questions the person answered or skipped; an empty answer is still an answer. */
  answered?: string[];
}

interface AppState extends Settings {
  setFontLevel: (l: FontLevel) => void;
  setHighContrast: (v: boolean) => void;
  scale: number;
  colors: Palette;
  categories: Category[];
  setCategories: (c: Category[]) => void;
  answers: Answers;
  setAnswers: (a: Answers) => void;
  /** Items the person wants to apply for (帶去臨櫃 / 請人幫我). */
  chosen: string[];
  toggleChosen: (id: string) => void;
  setChosen: (ids: string[]) => void;
  /** Where nearby places are measured from; memory only, never stored. */
  origin: Origin | null;
  setOrigin: (o: Origin | null) => void;
  loaded: boolean;
}

const SETTINGS_KEY = 'welfare-settings-v1';
const SESSION_KEY = 'welfare-session-v1';
const EMPTY_ANSWERS: Answers = { profile: { identities: [] }, unknownIdentities: [] };

function loadSettings(): Settings {
  const fallback: Settings = { fontLevel: 'standard', highContrast: false };
  if (Platform.OS !== 'web') return fallback;
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>({ fontLevel: 'standard', highContrast: false });
  const [loaded, setLoaded] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [answers, setAnswers] = useState<Answers>(EMPTY_ANSWERS);
  const [chosen, setChosen] = useState<string[]>([]);
  const [origin, setOrigin] = useState<Origin | null>(null);

  // Read after mount so server-rendered HTML and the first client render agree.
  useEffect(() => {
    setSettings(loadSettings());
    if (Platform.OS === 'web') {
      try {
        const raw = globalThis.sessionStorage?.getItem(SESSION_KEY);
        if (raw) {
          const saved = JSON.parse(raw);
          setCategories(saved.categories ?? []);
          setAnswers(saved.answers ?? EMPTY_ANSWERS);
          setChosen(saved.chosen ?? []);
        }
      } catch {
        // Ignore unreadable session data.
      }
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded || Platform.OS !== 'web') return;
    try {
      globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Storage unavailable (private mode); settings stay for this visit only.
    }
  }, [settings, loaded]);

  // Keep answers across a refresh within the same tab.
  useEffect(() => {
    if (!loaded || Platform.OS !== 'web') return;
    try {
      globalThis.sessionStorage?.setItem(SESSION_KEY, JSON.stringify({ categories, answers, chosen }));
    } catch {
      // Storage unavailable; answers live in memory only.
    }
  }, [categories, answers, chosen, loaded]);

  const value = useMemo<AppState>(
    () => ({
      ...settings,
      setFontLevel: (fontLevel) => setSettings((s) => ({ ...s, fontLevel })),
      setHighContrast: (highContrast) => setSettings((s) => ({ ...s, highContrast })),
      scale: FONT_SCALE[settings.fontLevel],
      colors: settings.highContrast ? HIGH_CONTRAST : NORMAL,
      categories,
      setCategories,
      answers,
      setAnswers,
      chosen,
      toggleChosen: (id) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id])),
      setChosen,
      origin,
      setOrigin,
      loaded,
    }),
    [settings, categories, answers, chosen, origin, loaded],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside AppStateProvider');
  return v;
}
