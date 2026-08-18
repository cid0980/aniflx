import type { MetadataRoute } from 'next';

/**
 * PWA Manifest — to change the app name or icon:
 *
 * APP NAME:
 *   Change `name` and `short_name` below.
 *   Also update `title` and `applicationName` in src/app/layout.tsx
 *   And the header text in src/app/page.tsx (search for "Cid's Anime")
 *
 * APP ICON:
 *   Replace these files in the `public/` folder:
 *     public/icon-512.png  — 512×512 px (main icon)
 *     public/icon-192.png  — 192×192 px (smaller icon)
 *   Then reinstall the PWA on your phone.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AniFlix",
    short_name: 'AniFlix',
    description: 'Personal anime streaming app for Cid.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0a0a0f',
    theme_color: '#0a0a0f',
    orientation: 'portrait-primary',
    lang: 'en',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/icon-192.png',
        sizes: '180x180',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
