import { NextRequest } from 'next/server';
import { impersonateFetch } from '@/lib/impersonate-fetch';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) {
    return Response.json({ error: { type: 'VALIDATION', message: 'url required', technical: 'Missing url param' } }, { status: 400 });
  }

  try {
    const resp = await impersonateFetch(url);
    const base = new URL(url);

    // Determine if this is a master playlist (contains #EXT-X-STREAM-INF)
    // or a variant/media playlist (contains #EXTINF)
    const isMaster = resp.body.includes('#EXT-X-STREAM-INF');

    const rewritten = resp.body
      .split('\n')
      .map((line: string) => {
        const t = line.trim();

        // Rewrite URI= attributes (encryption keys, I-FRAME playlists)
        if (t.startsWith('#') && t.includes('URI="')) {
          return t.replace(/URI="([^"]+)"/g, (_match: string, uri: string) => {
            try {
              const absolute = new URL(uri, base).toString();
              if (uri.endsWith('.m3u8')) {
                // Sub-playlist: route through hlsproxy
                return `URI="/api/hlsproxy?url=${encodeURIComponent(absolute)}"`;
              }
              // Key or other resource: route through proxy
              return `URI="/api/proxy?url=${encodeURIComponent(absolute)}"`;
            } catch { return `URI="${uri}"`; }
          });
        }

        // Skip empty lines and other comment lines
        if (!t || t.startsWith('#')) return line;

        // URL line — rewrite it
        try {
          const absolute = new URL(t, base).toString();
          if (isMaster || t.endsWith('.m3u8')) {
            // Variant playlist URL in master → route through hlsproxy
            return `/api/hlsproxy?url=${encodeURIComponent(absolute)}`;
          }
          // Segment URL → route through proxy
          return `/api/proxy?url=${encodeURIComponent(absolute)}`;
        } catch { return line; }
      })
      .join('\n');

    return new Response(rewritten, {
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: { type: 'PROXY_ERROR', message: 'HLS proxy error', technical: msg } }, { status: 500 });
  }
}
