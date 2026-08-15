import { searchAnime } from '@/lib/anime-api';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q) {
    return Response.json(
      { error: { type: 'VALIDATION', message: 'Search query required', technical: 'Missing "q" query parameter.' } },
      { status: 400 }
    );
  }

  const page = parseInt(req.nextUrl.searchParams.get('page') || '1', 10);

  try {
    const result = await searchAnime(q, page);
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: 502 });
    }
    return Response.json({ results: result.results, hasNextPage: result.hasNextPage });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({
      error: {
        type: 'SERVER_CRASH',
        message: 'Search request failed unexpectedly',
        technical: `Unhandled exception in /api/search: ${msg}`,
      }
    }, { status: 500 });
  }
}
