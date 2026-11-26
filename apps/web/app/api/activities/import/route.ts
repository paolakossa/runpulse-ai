import { proxyActivityImport } from '../../../activity-import-proxy.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(request: Request): Promise<Response> {
  return proxyActivityImport(request);
}
