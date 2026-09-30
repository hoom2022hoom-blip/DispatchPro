
import type {NextConfig} from 'next';
import withPWA from 'next-pwa';

const isDevelopment = process.env.NODE_ENV === 'development';

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Allow cross-origin requests from our domain in development
  allowedDevOrigins: ['dispatchpro.jajliardo.com'],
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
  dest: 'public',
  register: !isDevelopment,
  skipWaiting: !isDevelopment,
  disable: isDevelopment,
};

export default withPWA(pwaConfig)(nextConfig as any);
