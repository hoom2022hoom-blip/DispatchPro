import { proxyReception } from '@/lib/reception-proxy';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function forward(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return proxyReception(request, (await context.params).path, process.env.DISPATCHPRO_API_URL);
}
export { forward as GET, forward as POST, forward as PUT, forward as DELETE };
