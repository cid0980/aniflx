import { findStreamForAnime } from '@/lib/anime-api';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; ep: string }> }
) {
  try {
    const { id, ep } = await params;
    const anilistId = parseInt(id, 10);
    const episode = parseInt(ep, 10);

    if (isNaN(anilistId) || isNaN(episode)) {
      return Response.json(
        { error: { type: 'VALIDATION', message: 'Invalid parameters', technical: `id="${id}" ep="${ep}" — both must be numbers.` } },
        { status: 400 }
      );
    }

    const title = req.nextUrl.searchParams.get('title') || '';
    const anidbId = req.nextUrl.searchParams.get('anidbId') || undefined;

    const result = await findStreamForAnime(anilistId, episode, title, anidbId);
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: 502 });
    }
    return Response.json({ stream: result.stream });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({
      error: { type: 'SERVER_CRASH', message: 'Stream lookup failed', technical: `Unhandled: ${msg}` }
    }, { status: 500 });
  }
}
