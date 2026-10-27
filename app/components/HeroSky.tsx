import { useEffect, useRef, useState } from 'react';

import type { Cond } from '@/lib/types';

/**
 * Animated sky behind the Now hero, painted back to front for depth: condition tint, sun or night sky,
 * far / mid / near cloud layers, precipitation at three depths, ground effects, lightning, vignette.
 * Pure SVG + CSS keyframes (globals.css, `.sky`), colored from theme-aware tokens; reduced motion freezes it.
 * Rain and snow move as whole layers (one tiled group per depth), so there are few animated elements.
 * The viewBox is square and sliced, so it covers the tile at any aspect.
 */

const W = 400;

/** Deterministic scatter (same layout every render) */
function scatter(n: number, seed: number): number[][] {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  return Array.from({ length: n }, () => [r(), r(), r(), r()]);
}

const circlePath = (x: number, y: number, r: number) =>
  `M${(x - r).toFixed(1)} ${y.toFixed(1)}a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(2 * r).toFixed(2)} 0a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(-2 * r).toFixed(2)} 0`;

/** One tile of rain streaks: tapered slivers over a 480-tall band, as a single path */
function rainTile(n: number, seed: number, len: [number, number], w: number): string {
  return scatter(n, seed).map(([x, y, a]) => {
    const X = -120 + x * 640, Y = y * 480, L = len[0] + a * (len[1] - len[0]);
    return `M${X.toFixed(1)} ${Y.toFixed(1)}l${w / 2} ${L.toFixed(1)}h${-w}z`;
  }).join('');
}

/** One tile of snow dots over a 420-tall band */
function snowTile(n: number, seed: number, r: [number, number]): string {
  return scatter(n, seed).map(([x, y, a]) => circlePath(-40 + x * 480, y * 420, r[0] + a * (r[1] - r[0]))).join('');
}

const RAIN = { far: rainTile(110, 3, [7, 11], 0.7), mid: rainTile(60, 5, [12, 18], 1.1), near: rainTile(24, 9, [22, 32], 1.8) };
const SNOW = { far: snowTile(130, 13, [0.5, 1.1]), mid: snowTile(60, 17, [1.2, 2]) };
const SNOW_NEAR = scatter(14, 19);
const CRYSTALS = scatter(6, 29);
const STARS = { dust: scatter(90, 31), small: scatter(60, 37), mid: scatter(24, 41), bright: scatter(7, 43) };
const SPLASH = scatter(14, 47);
const MOTES = scatter(18, 53);
const LEAVES = scatter(5, 59);

/* --- Clouds: soft puffs (radial-gradient circles) with a shaded underside and a lit crown --- */

type Puff = [number, number, number];
const SHAPES: Record<'a' | 'b' | 'c', Puff[]> = {
  a: [[30, 76, 22], [48, 66, 30], [68, 56, 36], [92, 46, 42], [118, 48, 40], [140, 56, 34], [160, 66, 28], [178, 76, 20],
    [56, 82, 30], [86, 80, 36], [116, 80, 36], [146, 82, 28], [104, 64, 40], [76, 68, 32], [132, 68, 30]],
  b: [[26, 68, 22], [50, 60, 28], [76, 54, 32], [104, 50, 34], [132, 52, 32], [158, 58, 28], [184, 66, 22],
    [44, 74, 26], [74, 74, 30], [106, 72, 32], [138, 74, 30], [168, 76, 24], [90, 62, 30], [120, 62, 30]],
  c: [[48, 66, 20], [66, 56, 26], [88, 48, 30], [110, 52, 28], [130, 60, 22], [146, 68, 16], [70, 72, 24], [100, 70, 26], [124, 72, 20]],
};

function CloudShape({ id, puffs }: { id: string; puffs: Puff[] }) {
  // The crown: the three highest puffs catch the light
  const crown = [...puffs].sort((a, b) => a[1] - a[2] - (b[1] - b[2])).slice(0, 3);
  return (
    <g id={id}>
      <g fill="url(#sky-puff-shade)">{puffs.map(([x, y, r], i) => <circle key={i} cx={x + 3} cy={y + 14} r={r * 1.1} />)}</g>
      <g fill="url(#sky-puff-body)">{puffs.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} />)}</g>
      <g fill="url(#sky-puff-light)">{crown.map(([x, y, r], i) => <circle key={i} cx={x - r * 0.18} cy={y - r * 0.28} r={r * 0.62} />)}</g>
    </g>
  );
}

interface CloudSpec { shape: 'a' | 'b' | 'c'; y: number; s: number; dur: number; delay: number }
const LAYERS: Record<'far' | 'mid' | 'near', CloudSpec[]> = {
  far: [
    { shape: 'b', y: 18, s: 0.5, dur: 260, delay: -40 },
    { shape: 'c', y: 64, s: 0.45, dur: 280, delay: -170 },
    { shape: 'a', y: 36, s: 0.55, dur: 240, delay: -110 },
    { shape: 'c', y: 96, s: 0.4, dur: 300, delay: -230 },
  ],
  mid: [
    { shape: 'a', y: 50, s: 0.95, dur: 170, delay: -25 },
    { shape: 'b', y: 120, s: 0.85, dur: 185, delay: -105 },
    { shape: 'c', y: 4, s: 0.9, dur: 160, delay: -70 },
    { shape: 'a', y: 170, s: 0.8, dur: 190, delay: -150 },
  ],
  near: [
    { shape: 'a', y: 150, s: 1.7, dur: 105, delay: -15 },
    { shape: 'b', y: -46, s: 1.8, dur: 115, delay: -70 },
    { shape: 'c', y: 236, s: 1.5, dur: 98, delay: -45 },
  ],
};

function CloudLayer({ layer, n, speed = 1 }: { layer: keyof typeof LAYERS; n: number; speed?: number }) {
  return (
    <g className={`clouds ${layer}`}>
      {LAYERS[layer].slice(0, n).map((c, i) => (
        <g key={i} className="drift" style={{ animationDuration: `${c.dur * speed}s`, animationDelay: `${c.delay * speed}s` }}>
          <use href={`#sky-cl-${c.shape}`} transform={`translate(0 ${c.y}) scale(${c.s})`} />
        </g>
      ))}
    </g>
  );
}

/* --- Sun and night sky --- */

const hexPath = (x: number, y: number, r: number) => Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 3) * i;
  return `${i ? 'L' : 'M'}${(x + Math.cos(a) * r).toFixed(1)} ${(y + Math.sin(a) * r).toFixed(1)}`;
}).join('') + 'z';

/** Sun bloom, corona, rays, and lens flare, drawn around (0, 0): HeroSky places it on the icon's sun */
function SunLight({ dim = false }: { dim?: boolean }) {
  // Lens flare: shapes along the line from the sun down through the middle of the card
  const flares: [number, number, 'dot' | 'hex'][] = [[0.3, 8, 'dot'], [0.46, 16, 'hex'], [0.62, 5, 'dot'], [0.8, 26, 'dot']];
  // The invisible circle makes each ray fan's box centered on the sun, so it turns about the sun (fill-box origin)
  const hub = <circle r="420" fill="none" />;
  return (
    <g className={`sunlight${dim ? ' dim' : ''}`}>
      <circle className="bloom" r="250" fill="url(#sky-bloom)" />
      <circle className="corona" r="78" fill="url(#sky-corona)" />
      {!dim && (
        <>
          <g className="beams a" fill="url(#sky-beam)">
            {hub}
            {Array.from({ length: 14 }, (_, i) => {
              const w = 6 + ((i * 7) % 5) * 3;
              return <path key={i} d={`M0 0L${w} -420L${-w} -420z`} transform={`rotate(${i * (360 / 14) + (i % 3) * 4})`} />;
            })}
          </g>
          <g className="beams b" fill="url(#sky-beam)">
            {hub}
            {Array.from({ length: 9 }, (_, i) => <path key={i} d="M0 0L18 -420L-18 -420z" transform={`rotate(${i * 40 + 13})`} />)}
          </g>
          <g className="flares">
            {flares.map(([t, r, kind], i) => {
              const x = -294 * t, y = 387 * t;
              if (kind === 'hex') return <path key={i} d={hexPath(x, y, r)} fill="var(--sky-flare)" />;
              return <circle key={i} cx={x} cy={y} r={r} fill="var(--sky-flare)" />;
            })}
          </g>
        </>
      )}
    </g>
  );
}

/** Dust catching the sunlight, scattered across the card */
function Motes() {
  return (
    <g className="motes">
      {MOTES.map(([x, y, a, b], i) => (
        <circle key={i} className="mote" cx={120 + x * 280} cy={40 + y * 320} r={0.6 + a * 1.2}
          style={{ animationDuration: `${9 + b * 9}s`, animationDelay: `${-a * 18}s` }} />
      ))}
    </g>
  );
}

const glintPath = (s: number) =>
  `M0 ${-s}L${s * 0.16} ${-s * 0.16}L${s} 0L${s * 0.16} ${s * 0.16}L0 ${s}L${-s * 0.16} ${s * 0.16}L${-s} 0L${-s * 0.16} ${-s * 0.16}z`;

function NightSky({ dense }: { dense: boolean }) {
  const dots = (pts: number[][], r: [number, number], h: number) =>
    pts.map(([x, y, a]) => circlePath(x * W, y * h, r[0] + a * (r[1] - r[0]))).join('');
  // The Milky Way: a soft diagonal band with a dust of faint stars along it
  const band = STARS.dust.map(([x, y, a]) => {
    const t = x * 520 - 60, off = (y - 0.5) * 70;
    return circlePath(t, 300 - t * 0.62 + off, 0.4 + a * 0.5);
  }).join('');
  return (
    <g className="night-sky">
      <ellipse cx="200" cy="175" rx="300" ry="46" transform="rotate(-32 200 175)" fill="url(#sky-milky)" />
      {dense && <path className="star-dust" d={band} />}
      <path className="stars s1" d={dots(STARS.small.slice(0, dense ? 60 : 30), [0.5, 0.9], 260)} />
      <path className="stars s2" d={dots(STARS.mid.slice(0, dense ? 24 : 12), [0.9, 1.5], 240)} />
      {STARS.bright.slice(0, dense ? 7 : 3).map(([x, y, a, b], i) => (
        // Bright glints stay right of the temperature and conditions text
        <g key={i} transform={`translate(${(W * (0.55 + x * 0.42)).toFixed(1)} ${(y * 220).toFixed(1)})`}>
          <path className="glint" d={glintPath(4 + a * 4)} style={{ animationDuration: `${3 + b * 4}s`, animationDelay: `${-a * 5}s` }} />
        </g>
      ))}
      <path className="shooting one" d="M150 30L40 100" stroke="url(#sky-meteor)" />
      <path className="shooting two" d="M380 140L300 190" stroke="url(#sky-meteor)" />
    </g>
  );
}

/* --- Weather --- */

function rainLayers(storm: boolean) {
  const layer = (k: keyof typeof RAIN, dur: number) => (
    <g className={`rain-layer ${k}`} style={{ animationDuration: `${dur}s` }}>
      <path d={RAIN[k]} />
      <path d={RAIN[k]} transform="translate(0 -480)" />
    </g>
  );
  return { far: layer('far', storm ? 1.05 : 1.3), mid: layer('mid', storm ? 0.75 : 0.95), near: layer('near', storm ? 0.5 : 0.65) };
}

function Splashes() {
  return (
    <g className="splashes">
      {SPLASH.map(([x, y, a, b], i) => (
        <g key={i} transform={`translate(${(x * W).toFixed(1)} ${(300 + y * 95).toFixed(1)})`}>
          <ellipse className="splash" rx={4 + a * 4} ry={1.2 + a} style={{ animationDuration: `${0.8 + b * 0.7}s`, animationDelay: `${-a * 1.5}s` }} />
        </g>
      ))}
    </g>
  );
}

function Crystal({ r }: { r: number }) {
  const arm = `M0 0V${-r}M0 ${-r * 0.55}L${-r * 0.3} ${-r * 0.8}M0 ${-r * 0.55}L${r * 0.3} ${-r * 0.8}M0 ${-r * 0.25}L${-r * 0.22} ${-r * 0.42}M0 ${-r * 0.25}L${r * 0.22} ${-r * 0.42}`;
  return <g>{[0, 60, 120, 180, 240, 300].map((a) => <path key={a} d={arm} transform={`rotate(${a})`} />)}</g>;
}

function snowLayers() {
  const layer = (k: keyof typeof SNOW, dur: number, sway: number) => (
    <g className={`snow-sway ${k}`} style={{ animationDuration: `${sway}s` }}>
      <g className="snow-layer" style={{ animationDuration: `${dur}s` }}>
        <path d={SNOW[k]} />
        <path d={SNOW[k]} transform="translate(0 -420)" />
      </g>
    </g>
  );
  return {
    far: layer('far', 22, 7),
    mid: layer('mid', 14, 5),
    near: (
      <g className="snow-near">
        {SNOW_NEAR.map(([x, , a, b], i) => (
          <g key={i} className="fall" style={{ animationDuration: `${7 + b * 5}s`, animationDelay: `${-a * 12}s` }}>
            <circle className="sway" cx={x * W} cy="0" r={3 + a * 3.5} fill="url(#sky-bokeh)"
              style={{ animationDuration: `${3 + a * 2}s`, animationDelay: `${-b * 4}s` }} />
          </g>
        ))}
        {CRYSTALS.map(([x, , a, b], i) => (
          <g key={`c${i}`} className="fall" style={{ animationDuration: `${10 + b * 6}s`, animationDelay: `${-a * 16}s` }}>
            <g transform={`translate(${(20 + x * 360).toFixed(1)} 0)`}>
              <g className="crystal" style={{ animationDuration: `${8 + a * 8}s` }}><Crystal r={4 + a * 3} /></g>
            </g>
          </g>
        ))}
      </g>
    ),
  };
}

function Fog() {
  const bank = (y: number, rx: number, ry: number, k: string, dur: number, delay: number) => (
    <g className={`fog-bank ${k}`} style={{ animationDuration: `${dur}s`, animationDelay: `${delay}s` }}>
      {[-0.5, 0.5, 1.5].map((o) => <ellipse key={o} cx={200 + o * rx * 1.4} cy={y} rx={rx} ry={ry} fill="url(#sky-fog)" />)}
    </g>
  );
  return (
    <g className="fog">
      {bank(120, 220, 34, 'far', 40, -10)}
      {bank(215, 240, 46, 'mid', 30, -22)}
      {bank(300, 260, 58, 'mid', 26, -5)}
      {bank(385, 280, 70, 'near', 22, -14)}
    </g>
  );
}

function Wind() {
  const gust = (y: number, amp: number, k: string, i: number) => (
    <path key={`${k}${i}`} className={`streak ${k}`} pathLength={1}
      d={`M-60 ${y}C40 ${y - amp},140 ${y + amp},240 ${y}S400 ${y - amp},470 ${y}`}
      style={{ animationDelay: `${-i * 1.1}s` }} />
  );
  return (
    <g className="wind">
      {[70, 150, 230, 310].map((y, i) => gust(y, 18, 'far', i))}
      {[110, 200, 290].map((y, i) => gust(y, 36, 'near', i))}
      {LEAVES.map(([, y, a, b], i) => (
        <g key={i} className="leaf-path" style={{ animationDuration: `${5 + b * 4}s`, animationDelay: `${-a * 9}s` }}>
          <g transform={`translate(0 ${(60 + y * 260).toFixed(1)})`}>
            <g className="leaf" style={{ animationDuration: `${1.2 + a}s` }}>
              <path d="M-6 0C-3-3.6 3-3.6 6 0C3 3.6-3 3.6-6 0z" fill={i % 2 ? '#d98a2b' : '#c9a23a'} />
              <path d="M-5 0H5" stroke="rgba(0,0,0,.25)" strokeWidth=".6" />
            </g>
          </g>
        </g>
      ))}
    </g>
  );
}

function Lightning() {
  return (
    <g className="lightning">
      <path className="bolt one" d="M120-5L112 40L124 52L104 100L118 108L96 170L108 176L90 236M112 100L136 132L128 150L148 184M104 160L82 184L88 200" />
      <path className="bolt two" d="M300-5L308 30L295 44L312 92L299 100L318 152M299 100L282 122L289 138" />
      <circle className="cloud-lit one" cx="118" cy="70" r="150" fill="url(#sky-lit)" />
      <circle className="cloud-lit two" cx="302" cy="50" r="120" fill="url(#sky-lit)" />
    </g>
  );
}

/** Cloud layers (far, mid, near) per condition */
const CLOUDS: Record<Cond, [number, number, number]> = {
  clear: [0, 0, 0], pcloudy: [3, 1, 1], cloudy: [4, 3, 2], rain: [3, 3, 2], storm: [4, 4, 3],
  snow: [3, 2, 1], fog: [2, 0, 0], wind: [3, 2, 0],
};

/** Where the sun or moon sits in the 64-unit HeroIcon, so the sky's light lines up with it */
function iconLight(code: Cond, night: boolean): [number, number] {
  if (code === 'pcloudy') return night ? [23, 22] : [23, 23];
  if (code === 'fog') return [34, 24];
  return night ? [30, 32] : [32, 32];
}

/** The hero's size and its icon's box, in the hero's pixels */
function useHeroBox() {
  const ref = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0, ix: 0, iy: 0, is: 0 });
  useEffect(() => {
    const svg = ref.current, hero = svg?.parentElement;
    if (!svg || !hero) return;
    const measure = () => {
      const r = svg.getBoundingClientRect(), ico = hero.querySelector('.hero-ico')?.getBoundingClientRect();
      const next = {
        w: Math.round(r.width), h: Math.round(r.height),
        ix: ico ? ico.left - r.left : r.width * 0.8, iy: ico ? ico.top - r.top : 20, is: ico?.width ?? 100,
      };
      setBox((b) => (b.w === next.w && b.h === next.h && Math.abs(b.ix - next.ix) < 0.5 && Math.abs(b.iy - next.iy) < 0.5 && b.is === next.is ? b : next));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(hero);
    const ico = hero.querySelector('.hero-ico');
    if (ico) ro.observe(ico);
    return () => ro.disconnect();
  }, []);
  return [ref, box] as const;
}

export default function HeroSky({ code, night }: { code: Cond; night: boolean }) {
  const [ref, { w, h, ix, iy, is }] = useHeroBox();
  // The weather scene is authored in a 400-unit square, scaled to cover the card (like `xMidYMin slice`).
  // The sun and moon light are placed in card pixels on the icon, so they line up at any size.
  const k = Math.max(w, h) / W, ox = (w - W * k) / 2;
  const [lx, ly] = iconLight(code, night);
  const ax = ix + (lx / 64) * is, ay = iy + (ly / 64) * is;

  const clearish = code === 'clear' || code === 'pcloudy';
  const wet = code === 'rain' || code === 'storm';
  const rain = wet ? rainLayers(code === 'storm') : null;
  const snow = code === 'snow' ? snowLayers() : null;
  const [far, mid, near] = CLOUDS[code];
  const speed = code === 'wind' ? 0.3 : code === 'storm' ? 0.7 : 1;

  return (
    <svg ref={ref} className={`sky sky-${code} ${night ? 'is-night' : 'is-day'}`} viewBox={`0 0 ${w || 1} ${h || 1}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="sky-tint" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--tint-top)" />
          <stop offset="1" stopColor="var(--tint-bot)" />
        </linearGradient>
        <radialGradient id="sky-vignette" cx=".5" cy=".42" r=".75">
          <stop offset=".55" stopColor="var(--sky-vignette)" stopOpacity="0" />
          <stop offset="1" stopColor="var(--sky-vignette)" />
        </radialGradient>
        <radialGradient id="sky-bloom">
          <stop offset="0" stopColor="var(--fw-sun)" stopOpacity=".38" />
          <stop offset=".35" stopColor="var(--fw-sun)" stopOpacity=".12" />
          <stop offset="1" stopColor="var(--fw-sun)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="sky-corona">
          <stop offset="0" stopColor="#fff4d0" stopOpacity=".55" />
          <stop offset=".4" stopColor="var(--fw-sun)" stopOpacity=".22" />
          <stop offset="1" stopColor="var(--fw-sun)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="sky-beam" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="340">
          <stop offset="0" stopColor="var(--fw-sun)" stopOpacity=".09" />
          <stop offset="1" stopColor="var(--fw-sun)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="sky-moonglow">
          <stop offset="0" stopColor="var(--fw-moon)" stopOpacity=".24" />
          <stop offset="1" stopColor="var(--fw-moon)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="sky-milky">
          <stop offset="0" stopColor="var(--sky-star)" stopOpacity=".1" />
          <stop offset="1" stopColor="var(--sky-star)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="sky-meteor" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--sky-star)" />
          <stop offset="1" stopColor="var(--sky-star)" stopOpacity="0" />
        </linearGradient>
        {(['body', 'shade', 'light'] as const).map((k) => (
          <radialGradient key={k} id={`sky-puff-${k}`}>
            <stop offset="0" stopColor={`var(--cl-${k})`} stopOpacity=".7" />
            <stop offset=".35" stopColor={`var(--cl-${k})`} stopOpacity=".5" />
            <stop offset=".7" stopColor={`var(--cl-${k})`} stopOpacity=".18" />
            <stop offset="1" stopColor={`var(--cl-${k})`} stopOpacity="0" />
          </radialGradient>
        ))}
        <radialGradient id="sky-bokeh">
          <stop offset="0" stopColor="var(--sky-snow)" stopOpacity=".7" />
          <stop offset=".6" stopColor="var(--sky-snow)" stopOpacity=".35" />
          <stop offset="1" stopColor="var(--sky-snow)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="sky-fog">
          <stop offset="0" stopColor="var(--sky-fog)" />
          <stop offset=".6" stopColor="var(--sky-fog)" stopOpacity=".55" />
          <stop offset="1" stopColor="var(--sky-fog)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="sky-lit">
          <stop offset="0" stopColor="#e9e4ff" stopOpacity=".5" />
          <stop offset="1" stopColor="#e9e4ff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="sky-mist" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--sky-mist)" stopOpacity="0" />
          <stop offset="1" stopColor="var(--sky-mist)" />
        </linearGradient>
        <CloudShape id="sky-cl-a" puffs={SHAPES.a} />
        <CloudShape id="sky-cl-b" puffs={SHAPES.b} />
        <CloudShape id="sky-cl-c" puffs={SHAPES.c} />
      </defs>

      {w > 0 && (
        <>
          <rect width={w} height={h} fill="url(#sky-tint)" />
          {(clearish || code === 'fog') && (
            <g transform={`translate(${ax.toFixed(1)} ${ay.toFixed(1)}) scale(${k.toFixed(3)})`}>
              {!night && <SunLight dim={code === 'fog'} />}
              {night && clearish && <circle r="150" fill="url(#sky-moonglow)" />}
            </g>
          )}
          <g transform={`translate(${ox.toFixed(1)} 0) scale(${k.toFixed(3)})`}>
            {clearish && !night && <Motes />}
            {(clearish || code === 'wind') && night && <NightSky dense={code === 'clear'} />}
            {far > 0 && <CloudLayer layer="far" n={far} speed={speed} />}
            {code === 'storm' && <Lightning />}
            {rain?.far}
            {snow?.far}
            {mid > 0 && <CloudLayer layer="mid" n={mid} speed={speed} />}
            {rain?.mid}
            {snow?.mid}
            {code === 'fog' && <Fog />}
            {near > 0 && <CloudLayer layer="near" n={near} speed={speed} />}
            {rain?.near}
            {snow?.near}
            {wet && <rect y={W * 0.6} width={W} height={W * 0.4} fill="url(#sky-mist)" />}
            {wet && <Splashes />}
            {code === 'wind' && <Wind />}
          </g>
          {code === 'storm' && <rect className="flash" width={w} height={h} />}
          <rect width={w} height={h} fill="url(#sky-vignette)" />
        </>
      )}
    </svg>
  );
}
