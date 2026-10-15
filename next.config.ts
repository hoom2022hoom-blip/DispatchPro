
import type {NextConfig} from 'next';
import withPWA from 'next-pwa';

const isDevelopment = process.env.NODE_ENV === 'development';

const nextConfig: NextConfig = {
  // Allow validation builds without replacing the running development output.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  ...(process.env.DISPATCHPRO_VERIFY_BUILD === '1' ? {experimental: {cpus: 2}} : {}),
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Allow cross-origin requests from our domain in development
  allowedDevOrigins: ['dispatchpro.jajliardo.com', 'office.nablustaxi.com'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

const pwaConfig = {
  // Tenant-authenticated reception responses must never enter the shared offline cache.
  runtimeCaching: [
    { urlPattern: /\/api\/(?:customer\/|reception\/|calls(?:\?|$))/, handler: 'NetworkOnly', method: 'GET' },
    ...require('next-pwa/cache'),
  ],
  dest: process.env.NEXT_PWA_DEST || 'public',
  register: !isDevelopment,
  skipWaiting: !isDevelopment,
  disable: isDevelopment,
};

export default withPWA(pwaConfig)(nextConfig as any);
