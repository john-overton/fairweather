import type { Metadata, Viewport } from 'next';
import { Big_Shoulders, IBM_Plex_Mono, Public_Sans } from 'next/font/google';

import { BASE } from './lib/base';
import { themeBootstrapScript } from './lib/theme';
import './globals.css';

const display = Big_Shoulders({ subsets: ['latin'], axes: ['opsz'], variable: '--fw-font-display', display: 'swap', adjustFontFallback: false });
const body = Public_Sans({ subsets: ['latin'], variable: '--fw-font-body', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--fw-font-mono', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL('https://openglades.com'),
  title: 'Fairweather',
  description: 'Personal, ad-free weather for Kansas City and the US. NWS forecasts, observations, alerts, and radar. No login.',
  manifest: `${BASE}/manifest.webmanifest`,
  applicationName: 'Fairweather',
  appleWebApp: { capable: true, title: 'Fairweather', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
  icons: {
    icon: [{ url: `${BASE}/icons/icon.svg`, type: 'image/svg+xml' }, { url: `${BASE}/icons/icon-192.png`, sizes: '192x192', type: 'image/png' }],
    apple: `${BASE}/icons/apple-touch-icon.png`,
  },
  openGraph: {
    title: 'Fairweather · Open Glades',
    description: 'Personal, ad-free weather. NWS forecasts, observations, alerts, and radar. No login.',
    url: `${BASE}`,
    images: [`${BASE}/icons/icon-512.png`],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#e7ecf0',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The bootstrap script sets data-theme and color tokens on <html> before hydration
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        {/* Applies the stored theme before first paint so there is no flash of the wrong palette */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript() }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
