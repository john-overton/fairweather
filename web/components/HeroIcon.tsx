import { useId } from 'react';

import type { Cond } from '@/lib/types';

/**
 * Illustrated, animated condition icon for the Now hero (64 x 64). Animations live in globals.css (`.hi-*`).
 * The small icons elsewhere stay as WxIcon line art.
 */

/** Cumulus with a flat base, about x 8–56, y 16–46 */
const CLOUD = 'M18 46a9 9 0 0 1-1.2-17.9a13 13 0 0 1 24.6-4.6a10 10 0 0 1 13.9 8.6a7 7 0 0 1-1.3 13.9z';
const DROP = 'M0 0C1.4 2.4 2.2 3.6 2.2 4.8a2.2 2.2 0 0 1-4.4 0C-2.2 3.6-1.4 2.4 0 0z';

type Tone = 'fair' | 'rain' | 'storm';
const TONES: Record<Tone, { front: [string, string]; back: [string, string] }> = {
  fair: { front: ['#ffffff', '#d9e1ea'], back: ['#e2e8ef', '#b3bfcd'] },
  rain: { front: ['#eef2f6', '#bcc6d2'], back: ['#b5bfcc', '#86929f'] },
  storm: { front: ['#a2acb9', '#5f6977'], back: ['#737d8b', '#434c58'] },
};

const sparkle = (x: number, y: number, s: number) =>
  `M${x} ${y - s}Q${x} ${y} ${x + s} ${y}Q${x} ${y} ${x} ${y + s}Q${x} ${y} ${x - s} ${y}Q${x} ${y} ${x} ${y - s}z`;

function Defs({ p, tone }: { p: string; tone: Tone }) {
  const t = TONES[tone];
  return (
    <defs>
      <radialGradient id={`${p}glow`}>
        <stop offset="0" stopColor="#ffc850" stopOpacity=".55" />
        <stop offset=".45" stopColor="#ffb83c" stopOpacity=".18" />
        <stop offset="1" stopColor="#ffb83c" stopOpacity="0" />
      </radialGradient>
      <radialGradient id={`${p}disk`} fx=".36" fy=".34">
        <stop offset="0" stopColor="#fff7d6" />
        <stop offset=".45" stopColor="#ffd45e" />
        <stop offset="1" stopColor="#f59f1a" />
      </radialGradient>
      <linearGradient id={`${p}ray`} x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stopColor="#ffd25a" />
        <stop offset="1" stopColor="#f7a325" />
      </linearGradient>
      <radialGradient id={`${p}moon`} fx=".3" fy=".3">
        <stop offset="0" stopColor="#fffdf4" />
        <stop offset=".6" stopColor="#ece9de" />
        <stop offset="1" stopColor="#c9cfdc" />
      </radialGradient>
      <radialGradient id={`${p}halo`}>
        <stop offset="0" stopColor="var(--hi-halo)" stopOpacity=".5" />
        <stop offset="1" stopColor="var(--hi-halo)" stopOpacity="0" />
      </radialGradient>
      {(['front', 'back'] as const).map((k) => (
        <linearGradient key={k} id={`${p}${k}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset=".1" stopColor={t[k][0]} />
          <stop offset="1" stopColor={t[k][1]} />
        </linearGradient>
      ))}
      <radialGradient id={`${p}shadow`}>
        <stop offset="0" stopColor="#000" stopOpacity=".28" />
        <stop offset="1" stopColor="#000" stopOpacity="0" />
      </radialGradient>
      <linearGradient id={`${p}drop`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#c4e4ff" />
        <stop offset="1" stopColor="#3a8bff" />
      </linearGradient>
      <linearGradient id={`${p}bolt`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff8c4" />
        <stop offset="1" stopColor="#ffb300" />
      </linearGradient>
      <radialGradient id={`${p}flash`}>
        <stop offset="0" stopColor="#fff3a8" stopOpacity=".8" />
        <stop offset="1" stopColor="#fff3a8" stopOpacity="0" />
      </radialGradient>
      <linearGradient id={`${p}fog`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="var(--hi-fog)" stopOpacity="0" />
        <stop offset=".25" stopColor="var(--hi-fog)" />
        <stop offset=".75" stopColor="var(--hi-fog)" />
        <stop offset="1" stopColor="var(--hi-fog)" stopOpacity="0" />
      </linearGradient>
    </defs>
  );
}

function Sun({ p, cx, cy, r }: { p: string; cx: number; cy: number; r: number }) {
  return (
    <g className="hi-sun">
      <circle className="hi-glow" cx={cx} cy={cy} r={r * 2.5} fill={`url(#${p}glow)`} />
      <g className="hi-rays" fill={`url(#${p}ray)`}>
        {Array.from({ length: 12 }, (_, i) => {
          const long = i % 2 === 0, r1 = r * 1.3, r2 = r * (long ? 1.95 : 1.65), w = r * (long ? 0.2 : 0.14);
          return <path key={i} d={`M${cx - w} ${cy - r1}L${cx} ${cy - r2}L${cx + w} ${cy - r1}z`} transform={`rotate(${i * 30} ${cx} ${cy})`} />;
        })}
      </g>
      <circle className="hi-disk" cx={cx} cy={cy} r={r} fill={`url(#${p}disk)`} stroke="#f29a12" strokeOpacity=".5" strokeWidth=".6" />
      <ellipse cx={cx - r * 0.34} cy={cy - r * 0.4} rx={r * 0.4} ry={r * 0.22} fill="#fff" opacity=".4" transform={`rotate(-35 ${cx - r * 0.34} ${cy - r * 0.4})`} />
    </g>
  );
}

function Moon({ p, cx, cy, r, sparkles }: { p: string; cx: number; cy: number; r: number; sparkles: [number, number, number][] }) {
  return (
    <g className="hi-moon">
      <circle className="hi-glow" cx={cx} cy={cy} r={r * 2.3} fill={`url(#${p}halo)`} />
      <mask id={`${p}cres`}>
        <rect x="-10" y="-10" width="84" height="84" fill="#fff" />
        <circle cx={cx + r * 0.58} cy={cy - r * 0.32} r={r * 0.9} fill="#000" />
      </mask>
      <g className="hi-crescent" mask={`url(#${p}cres)`}>
        <circle cx={cx} cy={cy} r={r} fill={`url(#${p}moon)`} stroke="var(--hi-edge)" strokeWidth=".8" />
        <g fill="#8d97ab" opacity=".22">
          <circle cx={cx - r * 0.45} cy={cy + r * 0.15} r={r * 0.16} />
          <circle cx={cx - r * 0.15} cy={cy + r * 0.55} r={r * 0.11} />
          <circle cx={cx - r * 0.62} cy={cy - r * 0.3} r={r * 0.08} />
        </g>
      </g>
      {sparkles.map(([x, y, s], i) => (
        <path key={i} className="hi-sparkle" d={sparkle(x, y, s)} fill="var(--hi-sparkle)" style={{ animationDelay: `${-i * 1.1}s` }} />
      ))}
    </g>
  );
}

function Cloud({ p, kind, transform }: { p: string; kind: 'front' | 'back'; transform?: string }) {
  return (
    <g transform={transform}>
      <g className={`hi-cloud-${kind}`}>
        {kind === 'front' && <ellipse cx="34" cy="49" rx="21" ry="3.2" fill={`url(#${p}shadow)`} />}
        <path d={CLOUD} fill={`url(#${p}${kind})`} stroke="var(--hi-edge)" strokeWidth=".8" />
        {kind === 'front' && (
          <g fill="none" stroke="#fff" strokeLinecap="round" opacity=".75">
            <path d="M22.5 28.6a10 10 0 0 1 4.8-4.4" strokeWidth="1.6" />
            <path d="M33 21.5a11 11 0 0 1 6.5 1.2" strokeWidth="1.3" opacity=".7" />
          </g>
        )}
      </g>
    </g>
  );
}

export default function HeroIcon({ code, night }: { code: Cond; night: boolean }) {
  const p = `hi${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const tone: Tone = code === 'storm' ? 'storm' : code === 'rain' ? 'rain' : 'fair';
  const overcast = code === 'cloudy' || code === 'rain' || code === 'storm';
  const front = code === 'pcloudy' ? 'translate(7 8) scale(.9)' : overcast || code === 'snow' ? 'translate(3 2)' : undefined;
  let body: React.ReactNode;

  if (code === 'clear') {
    body = night
      ? <Moon p={p} cx={30} cy={32} r={16} sparkles={[[52, 14, 3.4], [54, 42, 2.2], [11, 52, 2]]} />
      : <Sun p={p} cx={32} cy={32} r={13} />;
  } else if (code === 'wind') {
    body = (
      <g fill="none" stroke="var(--hi-gust)" strokeLinecap="round" strokeWidth="3.2">
        {['M8 24h29a8 8 0 1 0-8-8', 'M8 34h40a8 8 0 1 1-8 8', 'M8 44h19'].map((d, i) => (
          <path key={i} className="hi-gust" d={d} pathLength={1} style={{ animationDelay: `${-i * 0.6}s` }} />
        ))}
        <g className="hi-leaf">
          <path d="M0 0C3-3.4 8-3.4 11 0C8 3.4 3 3.4 0 0z" fill="#e6a033" stroke="#b86f12" strokeWidth=".6" />
          <path d="M1 0H9" stroke="#b86f12" strokeWidth=".6" />
        </g>
      </g>
    );
  } else {
    body = (
      <>
        {code === 'pcloudy' && (night
          ? <Moon p={p} cx={23} cy={22} r={11} sparkles={[[52, 10, 2.8], [8, 44, 1.8]]} />
          : <Sun p={p} cx={23} cy={23} r={10} />)}
        {overcast && <Cloud p={p} kind="back" transform="translate(-6 -8) scale(.8)" />}
        {code === 'storm' && <circle className="hi-flash" cx="34" cy="50" r="18" fill={`url(#${p}flash)`} />}
        {(code === 'rain' || code === 'storm') && [24, 31, 38, 45].filter((_, i) => code === 'rain' || i % 2 === 0).map((x, i) => (
          <g key={x} transform={`translate(${x} 51)`}>
            <path className="hi-drop" d={DROP} fill={`url(#${p}drop)`} style={{ animationDelay: `${-i * 0.33}s` }} />
          </g>
        ))}
        {code === 'snow' && [21, 33, 45].map((x, i) => (
          <g key={x} transform={`translate(${x} 53)`}>
            <g className="hi-flake" style={{ animationDelay: `${-i * 0.93}s` }}>
              <g className="hi-spin" stroke="var(--hi-flake)" strokeWidth=".9" strokeLinecap="round" fill="none">
                {[0, 60, 120].map((a) => <path key={a} d="M0-4.2V4.2M-1.2-3.4L0-2.4L1.2-3.4M-1.2 3.4L0 2.4L1.2 3.4" transform={`rotate(${a})`} />)}
              </g>
            </g>
          </g>
        ))}
        <Cloud p={p} kind="front" transform={code === 'fog' ? 'translate(0 -6)' : front} />
        {code === 'storm' && (
          <path className="hi-bolt" d="M35 40L27 53h6l-4 11l12-15h-6l4-9z" fill={`url(#${p}bolt)`} stroke="#d98200" strokeWidth=".7" strokeLinejoin="round" />
        )}
        {code === 'fog' && [[12, 46, 40], [16, 52, 36], [10, 58, 42]].map(([x, y, w], i) => (
          <rect key={i} className="hi-fogbar" x={x} y={y} width={w} height="3.2" rx="1.6" fill={`url(#${p}fog)`} style={{ animationDelay: `${-i * 1.6}s` }} />
        ))}
      </>
    );
  }

  return (
    <svg className={`hero-ico hi hi-${code}`} viewBox="0 0 64 64" aria-hidden="true">
      <Defs p={p} tone={tone} />
      {body}
    </svg>
  );
}
