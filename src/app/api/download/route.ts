import { NextRequest } from 'next/server';
import { impersonateFetch, impersonateFetchBinary } from '@/lib/impersonate-fetch';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const masterUrl = req.nextUrl.searchParams.get('url');
  const filename = req.nextUrl.searchParams.get('name') || 'episode';
  const infoOnly = req.nextUrl.searchParams.get('info') === '1';

  if (!masterUrl) {
    return Response.json({ error: 'url required' }, { status: 400 });
  }

  try {
    // 1. Fetch master m3u8 → find best quality variant
    const masterResp = await impersonateFetch(masterUrl);
    const masterLines = masterResp.body.split('\n');
    let variantUrl: string | null = null;
    for (let i = 0; i < masterLines.length; i++) {
      if (masterLines[i].includes('#EXT-X-STREAM-INF')) {
        const nextLine = masterLines[i + 1]?.trim();
        if (nextLine && !nextLine.startsWith('#')) {
          variantUrl = new URL(nextLine, masterUrl).toString();
          break;
        }
      }
    }
    const targetUrl = variantUrl || masterUrl;

    // 2. Fetch media playlist → extract segment URLs
    const mediaResp = await impersonateFetch(targetUrl);
    const mediaBase = new URL(targetUrl);
    const segmentUrls: string[] = [];
    for (const line of mediaResp.body.split('\n')) {
      const t = line.trim();
      if (t && !t.startsWith('#')) {
        try { segmentUrls.push(new URL(t, mediaBase).toString()); } catch { /* skip */ }
      }
    }

    if (segmentUrls.length === 0) {
      return Response.json({ error: 'No segments found' }, { status: 404 });
    }

    // Info-only mode: return segment count without downloading
    if (infoOnly) {
      return Response.json({ segments: segmentUrls.length });
    }

    // 3. Stream segments as newline-delimited chunks with progress markers
    // Format: each chunk is prefixed with a 12-byte header:
    //   "SEG:" (4 bytes) + segment_index as 4-byte uint32 + size as 4-byte uint32
    // The client reads these to track progress.
    // Actually simpler: use a custom header for total and let client count chunks.

    const safeName = filename.replace(/[^a-zA-Z0-9 _\-().]/g, '').slice(0, 100);
    const totalSegments = segmentUrls.length;

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for (let i = 0; i < totalSegments; i++) {
            const seg = await impersonateFetchBinary(segmentUrls[i]);
            controller.enqueue(new Uint8Array(seg.buffer));
          }
          controller.close();
        } catch (e) {
          controller.error(e);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'video/mp2t',
        'Content-Disposition': `attachment; filename="${safeName}.ts"`,
        'Access-Control-Allow-Origin': '*',
        'X-Total-Segments': String(totalSegments),
        'Access-Control-Expose-Headers': 'X-Total-Segments',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
