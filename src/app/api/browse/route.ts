import { browseAnime } from '@/lib/anime-api';
import type { BrowseSort } from '@/lib/anime-api';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

const VALID_SORTS: BrowseSort[] = ['trending', 'popular', 'recent', 'top', 'upcoming'];

export async function GET(req: NextRequest) {
  const sort = (req.nextUrl.searchParams.get('sort') || 'trending') as BrowseSort;
  if (!VALID_SORTS.includes(sort)) {
    return Response.json({ error: { type: 'VALIDATION', message: 'Invalid sort', technical: `Valid: ${VALID_SORTS.join(', ')}` } }, { status: 400 });
  }
  const page = parseInt(req.nextUrl.searchParams.get('page') || '1', 10);

  try {
    const result = await browseAnime(sort, page);
    if (!result.ok) return Response.json({ error: result.error }, { status: 502 });
    return Response.json({ results: result.results, hasNextPage: result.hasNextPage });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: { type: 'SERVER_CRASH', message: 'Browse failed', technical: msg } }, { status: 500 });
  }
}
