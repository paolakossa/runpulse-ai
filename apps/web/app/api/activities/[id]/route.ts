import { proxyActivityRecord } from '../../../activity-api-proxy.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ActivityRouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: ActivityRouteContext): Promise<Response> {
  const { id } = await context.params;
  return proxyActivityRecord(request, id, 'GET');
}

export async function DELETE(request: Request, context: ActivityRouteContext): Promise<Response> {
  const { id } = await context.params;
  return proxyActivityRecord(request, id, 'DELETE');
}
