import type { MetadataRoute } from 'next';
import { APP_NAME, APP_DESCRIPTION } from '@/lib/branding';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: 'Arvox Hub',
    description: APP_DESCRIPTION,
    start_url: '/boards',
    display: 'standalone',
    background_color: '#0D0D0D',
    theme_color: '#D10419',
    icons: [
      // SVG icons keep the repo text-only. If you need iOS splash/touch icons later,
      // add PNGs in a follow-up.
      {
        src: '/icons/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
      {
        src: '/icons/maskable.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  };
}

