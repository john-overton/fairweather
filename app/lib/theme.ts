import themesJson from '@/lib/themes.json';

export type Mode = 'system' | 'light' | 'dark';

export interface Palette {
  bg: string; surface: string; surface2: string; ink: string; muted: string; line: string;
  accent: string; onAccent: string; cool: string; heroA: string; heroB: string;
}

export interface Theme { id: string; name: string; inspiredBy: string; light: Palette; dark: Palette }

const KEYS: (keyof Palette)[] = ['bg', 'surface', 'surface2', 'ink', 'muted', 'line', 'accent', 'onAccent', 'cool', 'heroA', 'heroB'];
const toPalette = (a: string[]) => Object.fromEntries(KEYS.map((k, i) => [k, a[i]])) as unknown as Palette;

export const THEMES: Theme[] = Object.entries(themesJson as Record<string, { name: string; inspiredBy: string; light: string[]; dark: string[] }>)
  .map(([id, t]) => ({ id, name: t.name, inspiredBy: t.inspiredBy, light: toPalette(t.light), dark: toPalette(t.dark) }));

/** CSS custom property per token. Alert colors stay fixed per mode in fairweather.css. */
const CSS_VARS: Record<keyof Palette, string> = {
  bg: '--fw-bg', surface: '--fw-surface', surface2: '--fw-surface-2', ink: '--fw-ink', muted: '--fw-muted', line: '--fw-line',
  accent: '--fw-accent', onAccent: '--fw-on-accent', cool: '--fw-cool', heroA: '--fw-hero-a', heroB: '--fw-hero-b',
};

/**
 * Inline <script> body that applies the stored theme before first paint (no flash).
 * Kept dependency-free; it duplicates applyTheme() below.
 */
export function themeBootstrapScript(): string {
  const data = JSON.stringify(Object.fromEntries(THEMES.map((t) => [t.id, [t.light, t.dark]])));
  return `(function(){try{var T=${data},V=${JSON.stringify(CSS_VARS)};
function g(k,d){try{var v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}}
var id=g('wx.themeId','prairie'),mo=g('wx.mode','system');if(!T[id])id='prairie';
var dk=mo==='dark'||(mo==='system'&&window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches);
var p=T[id][dk?1:0],r=document.documentElement,s=r.style;r.setAttribute('data-theme',dk?'dark':'light');
for(var k in V)s.setProperty(V[k],p[k]);s.setProperty('--fw-glass',p.surface+'e6');s.colorScheme=dk?'dark':'light';
var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',p.bg);}catch(e){}})();`;
}

export function effectiveMode(mode: Mode): 'light' | 'dark' {
  if (mode !== 'system') return mode;
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(themeId: string, mode: Mode) {
  const theme = THEMES.find((t) => t.id === themeId) ?? THEMES[0];
  const m = effectiveMode(mode);
  const p = theme[m];
  const root = document.documentElement;
  root.setAttribute('data-theme', m);
  for (const k of KEYS) root.style.setProperty(CSS_VARS[k], p[k]);
  root.style.setProperty('--fw-glass', `${p.surface}e6`);
  root.style.colorScheme = m;
  document.querySelectorAll('meta[name="theme-color"]').forEach((el) => el.setAttribute('content', p.bg));
}
