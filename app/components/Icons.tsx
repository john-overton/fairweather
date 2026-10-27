import type { Cond } from '@/lib/types';

const CLOUD = 'M7.5 19h10a3.8 3.8 0 0 0 .4-7.58A5.6 5.6 0 0 0 7.2 10.2 4.4 4.4 0 0 0 7.5 19z';

function Sun({ cx, cy, r, rl }: { cx: number; cy: number; r: number; rl: number }) {
  return (
    <>
      <circle cx={cx} cy={cy} r={r} fill="var(--fw-sun)" stroke="none" />
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4;
        return (
          <line
            key={i}
            x1={(cx + Math.cos(a) * (r + 1.6)).toFixed(2)} y1={(cy + Math.sin(a) * (r + 1.6)).toFixed(2)}
            x2={(cx + Math.cos(a) * (r + 1.6 + rl)).toFixed(2)} y2={(cy + Math.sin(a) * (r + 1.6 + rl)).toFixed(2)}
            stroke="var(--fw-sun)"
          />
        );
      })}
    </>
  );
}

function Moon({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <path
      d={`M${cx + r * 0.35} ${cy - r} a${r} ${r} 0 1 0 ${r * 0.65} ${r * 1.45} a${r * 0.8} ${r * 0.8} 0 0 1 ${-r * 0.65} ${-r * 1.45}z`}
      fill="var(--fw-moon)" stroke="none"
    />
  );
}

/** Weather condition icon from the mock's set: clear, partly cloudy, cloudy, rain, storm, snow, wind, fog. */
export function WxIcon({ code, night = false, className }: { code: Cond; night?: boolean; className?: string }) {
  const tall = code === 'rain' || code === 'storm' || code === 'snow';
  let g: React.ReactNode;
  if (code === 'clear') {
    g = night ? <Moon cx={10} cy={7} r={6.5} /> : <Sun cx={12} cy={12} r={4.6} rl={2.6} />;
  } else if (code === 'wind') {
    g = <path d="M3 9h11a3 3 0 1 0-3-3M3 13h15a3 3 0 1 1-3 3M3 17h7" />;
  } else if (code === 'fog') {
    g = (
      <>
        <path d={CLOUD} fill="var(--fw-surface)" transform="translate(0 -4)" />
        <path d="M4 18.5h16M6 21.5h12" stroke="var(--fw-muted)" />
      </>
    );
  } else {
    g = (
      <>
        {code === 'pcloudy' && (night ? <Moon cx={8.5} cy={3.5} r={4.6} /> : <Sun cx={8.5} cy={8} r={3.2} rl={1.8} />)}
        <path d={CLOUD} fill="var(--fw-surface)" />
        {code === 'rain' && <path d="M9 21l-.8 2M13 21l-.8 2M17 21l-.8 2" stroke="var(--fw-cool)" />}
        {code === 'storm' && <path d="M13 15.5l-2.5 4h3l-2 4" stroke="var(--fw-accent)" strokeWidth={1.8} />}
        {code === 'snow' && (
          <g fill="var(--fw-cool)" stroke="none">
            <circle cx={9} cy={22} r={1} /><circle cx={13} cy={22.5} r={1} /><circle cx={17} cy={22} r={1} />
          </g>
        )}
      </>
    );
  }
  return (
    <svg
      className={className} viewBox={tall ? '0 0 26 26' : '0 0 24 24'} fill="none" stroke="currentColor"
      strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      {g}
    </svg>
  );
}

type IconProps = { size?: number };
const base = (size: number) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true,
});

export const SunIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)} strokeWidth={1.8}><circle cx="12" cy="12" r="4.5" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></svg>
);
export const MoonIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)} strokeWidth={1.8}><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg>
);
export const PaletteIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)} strokeWidth={1.8}>
    <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z" />
    <circle cx="7.5" cy="11" r="1.2" fill="currentColor" /><circle cx="10.5" cy="7.5" r="1.2" fill="currentColor" /><circle cx="15" cy="7.5" r="1.2" fill="currentColor" />
  </svg>
);
export const ChevronDown = ({ size = 16, rotate = 0 }: IconProps & { rotate?: number }) => (
  <svg {...base(size)} strokeWidth={2.4} style={{ transform: `rotate(${rotate}deg)`, transition: 'transform .15s' }}><path d="M6 9l6 6 6-6" /></svg>
);
export const ChevronLeft = ({ size = 18 }: IconProps) => <svg {...base(size)} strokeWidth={2.2}><path d="M15 6l-6 6 6 6" /></svg>;
export const ChevronRight = ({ size = 18 }: IconProps) => <svg {...base(size)} strokeWidth={2.2}><path d="M9 6l6 6-6 6" /></svg>;
export const WarnIcon = ({ size = 22 }: IconProps) => (
  <svg {...base(size)} strokeWidth={2}><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.01" /></svg>
);
export const PlayIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>;
export const PauseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
);
export const TargetIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)} strokeWidth={2}><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
);
export const ReplayIcon = ({ size = 14 }: IconProps) => <svg {...base(size)} strokeWidth={2.2}><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" /></svg>;
export const BellIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)} strokeWidth={1.8}><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
);
export const InfoIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)} strokeWidth={1.8}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.01" /></svg>
);
export const PinIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)} strokeWidth={2}><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
);
export const CloseIcon = ({ size = 16 }: IconProps) => <svg {...base(size)} strokeWidth={2.2}><path d="M6 6l12 12M18 6L6 18" /></svg>;

export const TAB_ICONS: Record<string, React.ReactNode> = {
  now: <SunIcon size={24} />,
  hourly: <svg {...base(24)} strokeWidth={1.8}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  'ten-day': <svg {...base(24)} strokeWidth={1.8}><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>,
  radar: (
    <svg {...base(24)} strokeWidth={1.8}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><path d="M12 12l6-6" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /></svg>
  ),
};
