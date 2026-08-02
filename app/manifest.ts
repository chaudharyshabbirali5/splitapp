import type { MetadataRoute } from 'next';

/**
 * Served by Next at /manifest.webmanifest, with the <link rel="manifest"> tag
 * injected automatically.
 *
 * Both `any` and `maskable` icons are listed: Android masks the maskable one to
 * whatever shape the launcher uses, and falls back to the plain one elsewhere.
 * Supplying only a maskable icon leaves visible padding on desktop; supplying
 * only a plain one gets it cropped on Android.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SplitApp',
    short_name: 'SplitApp',
    description: 'Split shared expenses and settle up.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#18181b',
    theme_color: '#18181b',
    categories: ['finance', 'productivity'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icon-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
