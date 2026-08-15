import { NextRequest } from 'next/server';
import { impersonateFetch, impersonateFetchBinary } from '@/lib/impersonate-fetch';

export const dynamic = 'force-dynamic';

/**
 * Downloads an HLS stream by fetching the m3u8 playlist,
 * then fetching every .ts/.xls segment and streaming them
 * concatenated as a single MPEG-TS file.
 *
 * Usage: /api/download?url=MASTER_M3U8_URL&name=filename
 */
export async function GET(req: NextRequest) {
  const masterUrl = req.nextUrl.searchParams.get('url');
  const filename = req.nextUrl.searchParams.get('name') || 'episode';

  if (!masterUrl) {
    return Response.json({ error: 'url required' }, { status: 400 });
  }

  try {
    // 1. Fetch master m3u8 to find the best quality variant
    const masterResp = await impersonateFetch(masterUrl);
    const masterLines = masterResp.body.split('\n');

    // Find the first variant playlist URL (highest quality is usually first)
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

    // If no variants found, maybe it's already a media playlist
    const targetUrl = variantUrl || masterUrl;

    // 2. Fetch the media playlist
    const mediaResp = await impersonateFetch(targetUrl);
    const mediaBase = new URL(targetUrl);

    // 3. Extract all segment URLs
    const segmentUrls: string[] = [];
    for (const line of mediaResp.body.split('\n')) {
      const t = line.trim();
      if (t && !t.startsWith('#')) {
        try {
          segmentUrls.push(new URL(t, mediaBase).toString());
        } catch { /* skip bad URLs */ }
      }
    }

    if (segmentUrls.length === 0) {
      return Response.json({ error: 'No segments found in playlist' }, { status: 404 });
    }

    // 4. Stream all segments concatenated as a single MPEG-TS download
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
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
