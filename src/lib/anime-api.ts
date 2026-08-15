/**
 * Anime API — uses anidb.app (same provider as ani-cli v5)
 * Bypasses Cloudflare via curl-impersonate binary (TLS fingerprint spoofing)
 */

import { impersonateFetch } from '@/lib/impersonate-fetch';

const BASE = 'https://anidb.app';
const ANILIST_URL = 'https://graphql.anilist.co';

// ── curl-impersonate wrapper ──
async function anidbFetch(url: string): Promise<string> {
  const r = await impersonateFetch(url);
  return r.body;
}

// ── Types ──
export interface ApiError {
  type: string;
  message: string;
  technical: string;
  statusCode?: number;
  raw?: string;
}

export interface AnimeResult {
  id: string;        // numeric ID from slug
  slug: string;      // full slug like "naruto-3686"
  title: string;
}

export interface AnimeSearchResult {
  id: number;
  title: string;
  titleJp: string | null;
  image: string;
  banner: string | null;
  format: string | null;
  episodes: number | null;
  status: string | null;
  score: number | null;
  year: number | null;
  genres: string[];
  description: string | null;
}

export interface AnimeDetail extends AnimeSearchResult {
  studios: string[];
  season: string | null;
  duration: number | null;
  source: string | null;
  // anidb-specific
  anidbId?: string;
  anidbSlug?: string;
  providerEpisodes?: EpisodeInfo[];
}

export interface EpisodeInfo {
  id: number;
  number: number;
  filler: boolean;
}

export interface StreamSource {
  url: string;
  quality: string;
  isM3U8: boolean;
}

export interface StreamResult {
  sources: StreamSource[];
  subtitles: Array<{ lang: string; url: string }>;
  headers?: Record<string, string>;
  provider: string;
}

// ── AniList for metadata ──
async function anilistQuery(query: string, variables: Record<string, unknown>) {
  const res = await fetch(ANILIST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`AniList HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

function mapMedia(media: Record<string, unknown>[]): AnimeSearchResult[] {
  return media.map((m) => {
    const t = m.title as Record<string, string>;
    const c = m.coverImage as Record<string, string>;
    return {
      id: m.id as number,
      title: t?.english || t?.romaji || 'Unknown',
      titleJp: t?.native || null,
      image: c?.extraLarge || c?.large || '',
      banner: (m.bannerImage as string) || null,
      format: (m.format as string) || null,
      episodes: (m.episodes as number) || null,
      status: (m.status as string) || null,
      score: (m.averageScore as number) || null,
      year: (m.seasonYear as number) || null,
      genres: (m.genres as string[]) || [],
      description: (m.description as string) || null,
    };
  });
}

const MEDIA_FIELDS = `id title { romaji english native }
  coverImage { large extraLarge } bannerImage
  format episodes status averageScore seasonYear genres
  description(asHtml: false)`;

export type BrowseSort = 'trending' | 'popular' | 'recent' | 'top' | 'upcoming';

export async function browseAnime(sort: BrowseSort = 'trending', page = 1): Promise<{ ok: boolean; results?: AnimeSearchResult[]; hasNextPage?: boolean; error?: ApiError }> {
  try {
    const now = new Date();
    const currentSeason = ['WINTER','SPRING','SUMMER','FALL'][Math.floor(now.getMonth() / 3)];
    const currentYear = now.getFullYear();

    let sortArg: string;
    let extraFilters = '';
    switch (sort) {
      case 'trending': sortArg = 'TRENDING_DESC'; extraFilters = ', status: RELEASING'; break;
      case 'popular': sortArg = 'POPULARITY_DESC'; break;
      case 'recent': sortArg = 'START_DATE_DESC'; extraFilters = `, seasonYear: ${currentYear}`; break;
      case 'top': sortArg = 'SCORE_DESC'; extraFilters = ', episodes_greater: 0'; break;
      case 'upcoming': sortArg = 'POPULARITY_DESC'; extraFilters = `, season: ${currentSeason}, seasonYear: ${currentYear}, status: NOT_YET_RELEASED`; break;
    }

    const gql = `query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage }
        media(type: ANIME, sort: ${sortArg}${extraFilters}) { ${MEDIA_FIELDS} }
      }
    }`;
    const json = await anilistQuery(gql, { page, perPage: 20 });
    const p = json.data?.Page;
    return { ok: true, results: mapMedia(p?.media || []), hasNextPage: p?.pageInfo?.hasNextPage || false };
  } catch (e) {
    return { ok: false, error: { type: 'ANILIST_ERROR', message: 'Browse failed', technical: `${e instanceof Error ? e.message : String(e)}` } };
  }
}

export async function searchAnime(query: string, page = 1): Promise<{ ok: boolean; results?: AnimeSearchResult[]; hasNextPage?: boolean; error?: ApiError }> {
  try {
    const gql = `query ($search: String, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage }
        media(search: $search, type: ANIME, sort: SEARCH_MATCH) { ${MEDIA_FIELDS} }
      }
    }`;
    const json = await anilistQuery(gql, { search: query, page, perPage: 20 });
    const p = json.data?.Page;
    return { ok: true, results: mapMedia(p?.media || []), hasNextPage: p?.pageInfo?.hasNextPage || false };
  } catch (e) {
    return { ok: false, error: { type: 'ANILIST_ERROR', message: 'Search failed', technical: `${e instanceof Error ? e.message : String(e)}` } };
  }
}

export async function getAnimeDetail(id: number): Promise<{ ok: boolean; anime?: AnimeDetail; error?: ApiError }> {
  try {
    const gql = `query ($id: Int) {
      Media(id: $id, type: ANIME) {
        id title { romaji english native }
        coverImage { large extraLarge } bannerImage
        format episodes status averageScore seasonYear season duration source genres
        description(asHtml: false)
        studios(isMain: true) { nodes { name } }
      }
    }`;
    const json = await anilistQuery(gql, { id });
    const m = json.data?.Media;
    if (!m) return { ok: false, error: { type: 'NOT_FOUND', message: 'Anime not found', technical: `No media for id=${id}` } };
    const t = m.title; const c = m.coverImage;
    
    // Try to find this anime on anidb.app
    const searchTitle = t?.romaji || t?.english || '';
    let anidbId: string | undefined;
    let anidbSlug: string | undefined;
    let providerEpisodes: EpisodeInfo[] | undefined;
    try {
      const anidbResult = await searchAnidb(searchTitle);
      if (anidbResult.length > 0) {
        // Try to match by title similarity
        const match = anidbResult.find(r => 
          r.title.toLowerCase() === (t?.english || '').toLowerCase() ||
          r.title.toLowerCase() === (t?.romaji || '').toLowerCase()
        ) || anidbResult[0];
        anidbId = match.id;
        anidbSlug = match.slug;

        const epsResult = await getEpisodes(match.id);
        if (epsResult.ok && epsResult.episodes?.length) {
          providerEpisodes = epsResult.episodes;
        }
      }
    } catch { /* ignore anidb search/episodes failure */ }

    return {
      ok: true,
      anime: {
        id: m.id, title: t?.english || t?.romaji || 'Unknown', titleJp: t?.native || null,
        image: c?.extraLarge || c?.large || '', banner: m.bannerImage || null,
        format: m.format || null, episodes: m.episodes || null, status: m.status || null,
        score: m.averageScore || null, year: m.seasonYear || null, genres: m.genres || [],
        description: m.description || null,
        studios: m.studios?.nodes?.map((s: { name: string }) => s.name) || [],
        season: m.season || null, duration: m.duration || null, source: m.source || null,
        anidbId, anidbSlug, providerEpisodes,
      },
    };
  } catch (e) {
    return { ok: false, error: { type: 'ANILIST_ERROR', message: 'Failed to get anime details', technical: `${e instanceof Error ? e.message : String(e)}` } };
  }
}

// ── anidb.app search (HTML scraping) ──
async function searchAnidb(query: string): Promise<AnimeResult[]> {
  const html = await anidbFetch(`${BASE}/browse?q=${encodeURIComponent(query)}`);
  const regex = /href="https:\/\/anidb\.app\/anime\/([^"]+)"[^>]*title="([^"]+)"/g;
  const results: AnimeResult[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    const slug = m[1];
    const numId = slug.match(/-(\d+)$/)?.[1];
    if (numId) {
      results.push({
        id: numId,
        slug,
        title: m[2].replace(/&#039;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"'),
      });
    }
  }
  return results;
}

// ── anidb.app episodes ──
export async function getEpisodes(anidbId: string): Promise<{ ok: boolean; episodes?: EpisodeInfo[]; error?: ApiError }> {
  try {
    const raw = await anidbFetch(`${BASE}/api/frontend/anime/${anidbId}/episodes`);
    const data = JSON.parse(raw);
    const episodes: EpisodeInfo[] = (data.episodes || []).map((e: { id: number; number: number; filler: boolean }) => ({
      id: e.id,
      number: e.number,
      filler: e.filler || false,
    }));
    return { ok: true, episodes };
  } catch (e) {
    return { ok: false, error: { type: 'ANIDB_ERROR', message: 'Failed to load episodes from anidb', technical: `anidb.app episodes API error: ${e instanceof Error ? e.message : String(e)}` } };
  }
}

// ── anidb.app streaming ──
export async function getStream(anidbEpId: number, lang = 'jpn'): Promise<{ ok: boolean; stream?: StreamResult; error?: ApiError }> {
  try {
    // 1. Get embed URLs
    const langRaw = await anidbFetch(`${BASE}/api/frontend/episode/${anidbEpId}/languages`);
    const langData = JSON.parse(langRaw);
    const languages: Array<{ code: string; name: string; embed_url: string }> = langData.languages || [];

    if (!languages.length) {
      return { ok: false, error: { type: 'NO_SOURCES', message: 'No language sources found', technical: `anidb returned empty languages for episode ${anidbEpId}` } };
    }

    // Prefer requested language, fallback to first
    const chosen = languages.find(l => l.code === lang) || languages[0];

    // 2. Get embed page → extract m3u8
    const embedHtml = await anidbFetch(chosen.embed_url);
    const m3u8Match = embedHtml.match(/file:\s*'([^']+)'/);
    if (!m3u8Match) {
      return { ok: false, error: { type: 'PROVIDER_ERROR', message: 'Could not extract stream URL', technical: `No file:'...' found in embed page. URL: ${chosen.embed_url}. HTML length: ${embedHtml.length}` } };
    }
    const masterUrl = m3u8Match[1];

    // Return the master m3u8 URL directly — let HLS.js handle quality selection
    return {
      ok: true,
      stream: {
        sources: [{ url: masterUrl, quality: 'auto', isM3U8: true }],
        subtitles: [],
        provider: `anidb/${chosen.name}`,
      },
    };
  } catch (e) {
    return { ok: false, error: { type: 'ANIDB_ERROR', message: 'Failed to get stream', technical: `anidb stream error: ${e instanceof Error ? e.message : String(e)}` } };
  }
}

// ── Combined: find stream for AniList anime + episode number ──
export async function findStreamForAnime(
  anilistId: number,
  episodeNum: number,
  title: string,
  anidbIdHint?: string
): Promise<{ ok: boolean; stream?: StreamResult; error?: ApiError }> {
  try {
    // Step 1: Find anidb ID
    let anidbId = anidbIdHint;
    if (!anidbId) {
      const searchResults = await searchAnidb(title);
      if (searchResults.length > 0) {
        anidbId = searchResults[0].id;
      }
    }

    if (!anidbId) {
      return { ok: false, error: { type: 'NOT_FOUND', message: `Could not find "${title}" on streaming provider`, technical: `Search for "${title}" on anidb.app returned no results. AniList ID: ${anilistId}` } };
    }

    // Step 2: Get episodes to find the right episode ID
    const epsResult = await getEpisodes(anidbId);
    if (!epsResult.ok || !epsResult.episodes) {
      return { ok: false, error: epsResult.error || { type: 'ANIDB_ERROR', message: 'Failed to load episodes', technical: 'Episodes request failed' } };
    }

    const targetEp = epsResult.episodes.find(e => e.number === episodeNum);
    if (!targetEp) {
      return { ok: false, error: { type: 'NOT_FOUND', message: `Episode ${episodeNum} not found`, technical: `anidb.app has ${epsResult.episodes.length} episodes for anime ${anidbId}, but episode ${episodeNum} was not among them. Available: ${epsResult.episodes.map(e => e.number).join(', ').slice(0, 200)}` } };
    }

    // Step 3: Get stream
    return await getStream(targetEp.id);
  } catch (e) {
    return { ok: false, error: { type: 'ANIDB_ERROR', message: 'Stream lookup failed', technical: `${e instanceof Error ? e.message : String(e)}` } };
  }
}
