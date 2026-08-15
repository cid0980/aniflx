import { NextRequest } from 'next/server';
import { impersonateFetch, impersonateFetchBinary } from '@/lib/impersonate-fetch';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  const mode = req.nextUrl.searchParams.get('mode') || 'text'; // text or binary
  if (!url) return Response.json({ error: 'url required' }, { status: 400 });

  try {
    if (mode === 'binary') {
      const result = await impersonateFetchBinary(url);
      const first20 = Array.from(result.buffer.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' ');
      const isMpegTs = result.buffer[0] === 0x47;
      return Response.json({
        ok: true,
        length: result.buffer.length,
        contentType: result.contentType,
        first20hex: first20,
        isMpegTs,
        isHtml: result.buffer.toString('utf-8', 0, 50).includes('<'),
        preview: result.buffer.toString('utf-8', 0, 100),
      });
    } else {
      const result = await impersonateFetch(url);
      return Response.json({
        ok: true,
        status: result.status,
        length: result.body.length,
        isM3u8: result.body.startsWith('#EXTM3U'),
        isHtml: result.body.includes('<!DOCTYPE') || result.body.includes('<html'),
        preview: result.body.slice(0, 500),
      });
    }
  } catch (e) {
    return Response.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
