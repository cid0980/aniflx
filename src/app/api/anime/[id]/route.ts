import { getAnimeDetail } from '@/lib/anime-api';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return Response.json(
        { error: { type: 'VALIDATION', message: 'Invalid anime ID', technical: `"${id}" is not a number.` } },
        { status: 400 }
      );
    }

    const fallbackTitle = req.nextUrl.searchParams.get('title') || undefined;
    const fallbackImage = req.nextUrl.searchParams.get('image') || undefined;
    const result = await getAnimeDetail(numId, fallbackTitle, fallbackImage);
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: 502 });
    }
    return Response.json({ anime: result.anime });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({
      error: { type: 'SERVER_CRASH', message: 'Failed to get anime details', technical: `Unhandled: ${msg}` }
    }, { status: 500 });
  }
}
