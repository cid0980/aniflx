import { NextRequest } from 'next/server';
import { impersonateFetchBinary } from '@/lib/impersonate-fetch';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) {
    return Response.json({ error: { type: 'VALIDATION', message: 'url required', technical: 'Missing url param' } }, { status: 400 });
  }

  try {
    const result = await impersonateFetchBinary(url);

    const headers = new Headers();
    headers.set('Content-Type', result.contentType);
    headers.set('Content-Length', String(result.buffer.length));
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', 'public, max-age=3600');

    // Handle range requests for video seeking
    const rangeHeader = req.headers.get('range');
    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1]);
        const end = match[2] ? parseInt(match[2]) : result.buffer.length - 1;
        const chunk = result.buffer.slice(start, end + 1);
        headers.set('Content-Range', `bytes ${start}-${end}/${result.buffer.length}`);
        headers.set('Content-Length', String(chunk.length));
        return new Response(new Uint8Array(chunk), { status: 206, headers });
      }
    }

    return new Response(new Uint8Array(result.buffer), { status: result.status, headers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json(
      { error: { type: 'PROXY_ERROR', message: 'Proxy error', technical: `${msg}. URL: ${url}` } },
      { status: 500 }
    );
  }
}
