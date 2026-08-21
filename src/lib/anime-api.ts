/**
 * Anime API — uses anidb.app (same provider as ani-cli v5)
 * Bypasses Cloudflare via curl-impersonate binary (TLS fingerprint spoofing)
 */

import { impersonateFetch } from '@/lib/impersonate-fetch';

const BASE = 'https://anidb.app';
const KITSU_URL = 'https://kitsu.io/api/edge';

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
  providerAliases?: string[];
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
  currentLang?: string;
  availableLangs?: Array<{ code: string; name: string }>;
}

// ── Kitsu for metadata/search/browse ──
async function kitsuFetch(path: string, params?: Record<string, string | number | undefined>) {
  const url = new URL(`${KITSU_URL}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
  }
  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/vnd.api+json' },
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Kitsu HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as {
    data: Array<Record<string, unknown>> | Record<string, unknown>;
    links?: { next?: string | null };
  };
}

function getKitsuAliases(item: Record<string, unknown>): string[] {
  const attrs = (item.attributes || {}) as Record<string, unknown>;
  const titles = (attrs.titles || {}) as Record<string, string>;
  const abbreviated = Array.isArray(attrs.abbreviatedTitles) ? attrs.abbreviatedTitles as string[] : [];
  const slug = typeof attrs.slug === 'string' ? attrs.slug.replace(/-/g, ' ') : '';
  return [...new Set([
    titles.en,
    titles.en_us,
    titles.en_jp,
    titles.ja_jp,
    titles.en_kr,
    titles.ko_kr,
    attrs.canonicalTitle as string,
    ...abbreviated,
    slug,
  ].filter((value): value is string => !!value?.trim()))];
}

function isJapaneseKitsu(item: Record<string, unknown>): boolean {
  const attrs = (item.attributes || {}) as Record<string, unknown>;
  const titles = (attrs.titles || {}) as Record<string, string>;
  const hasJapaneseTitle = Boolean(titles.ja_jp || titles.en_jp);
  const clearlyKoreanOrChinese = Boolean(titles.ko_kr || titles.en_kr || titles.zh_cn || titles.en_cn || titles.zh_tw);
  return hasJapaneseTitle && !clearlyKoreanOrChinese;
}

function mapKitsuAnime(item: Record<string, unknown>): AnimeSearchResult {
  const attrs = (item.attributes || {}) as Record<string, unknown>;
  const titles = (attrs.titles || {}) as Record<string, string>;
  const poster = (attrs.posterImage || {}) as Record<string, string>;
  const cover = (attrs.coverImage || {}) as Record<string, string>;
  const startDate = (attrs.startDate as string | undefined) || '';
  const year = startDate ? Number(startDate.slice(0, 4)) : null;
  const avg = attrs.averageRating ? Math.round(Number(attrs.averageRating)) : null;
  return {
    id: Number(item.id),
    title: titles.en || titles.en_us || (attrs.canonicalTitle as string) || titles.en_jp || 'Unknown',
    titleJp: titles.ja_jp || null,
    image: poster.large || poster.medium || poster.small || '',
    banner: cover.original || cover.large || cover.small || null,
    format: ((attrs.subtype as string) || '').toUpperCase() || null,
    episodes: (attrs.episodeCount as number | null) || null,
    status: ((attrs.status as string) || '').toUpperCase() || null,
    score: avg,
    year,
    genres: [],
    description: (attrs.synopsis as string) || (attrs.description as string) || null,
  };
}

// ── anidb.app scraping fallbacks ──
function mapAnidbToSearchResult(r: AnimeResult, image?: string): AnimeSearchResult {
  return {
    // Negative IDs identify anidb-only fallback records and avoid Kitsu ID collisions.
    id: -Number(r.id),
    title: r.title,
    titleJp: null,
    image: image || '',
    banner: null,
    format: null,
    episodes: null,
    status: null,
    score: null,
    year: null,
    genres: [],
    description: null,
  };
}

async function anidbBrowse(page: number): Promise<{ ok: boolean; results?: AnimeSearchResult[]; hasNextPage?: boolean; error?: ApiError }> {
  try {
    const html = await anidbFetch(`${BASE}/browse?page=${page}`);
    const results = parseAnidbHtml(html);
    return { ok: true, results: results.map(r => mapAnidbToSearchResult(r, extractImageFromSlug(html, r.slug))), hasNextPage: results.length >= 20 };
  } catch (e) {
    return { ok: false, error: { type: 'ANIDB_ERROR', message: 'Browse failed', technical: `${e instanceof Error ? e.message : String(e)}` } };
  }
}

async function anidbSearch(query: string): Promise<{ ok: boolean; results?: AnimeSearchResult[]; hasNextPage?: boolean; error?: ApiError }> {
  try {
    const results = await searchAnidb(query);
    return { ok: true, results: results.map(r => mapAnidbToSearchResult(r)), hasNextPage: false };
  } catch (e) {
    return { ok: false, error: { type: 'ANIDB_ERROR', message: 'Search failed', technical: `${e instanceof Error ? e.message : String(e)}` } };
  }
}

async function anidbDetail(title: string): Promise<{ ok: boolean; anime?: AnimeDetail; error?: ApiError }> {
  try {
    const results = await searchAnidb(title);
    if (!results.length) return { ok: false, error: { type: 'NOT_FOUND', message: 'Anime not found', technical: `No results on anidb for "${title}"` } };
    const match = results[0];
    const epsResult = await getEpisodes(match.id);
    const eps = epsResult.ok ? epsResult.episodes : undefined;
    return {
      ok: true,
      anime: {
        id: -Number(match.id),
        title: match.title,
        titleJp: null, image: '', banner: null, format: null,
        episodes: eps?.length || null, status: null, score: null, year: null,
        genres: [], description: null, studios: [], season: null, duration: null, source: null,
        anidbId: match.id, anidbSlug: match.slug, providerAliases: [title, match.title], providerEpisodes: eps,
      },
    };
  } catch (e) {
    return { ok: false, error: { type: 'ANIDB_ERROR', message: 'Detail failed', technical: `${e instanceof Error ? e.message : String(e)}` } };
  }
}

function parseAnidbHtml(html: string): AnimeResult[] {
  const regex = /href="https:\/\/anidb\.app\/anime\/([^"]+)"[^>]*title="([^"]+)"/g;
  const results: AnimeResult[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    const slug = m[1];
    const numId = slug.match(/-(\d+)$/)?.[1];
    if (numId && !results.some(r => r.id === numId)) {
      results.push({
        id: numId, slug,
        title: m[2].replace(/&#039;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"'),
      });
    }
  }
  return results;
}

function extractImageFromSlug(html: string, slug: string): string {
  const idx = html.indexOf(`/anime/${slug}"`);
  if (idx < 0) return '';
  const region = html.slice(Math.max(0, idx - 500), idx + 200);
  const imgMatch = region.match(/src="(https:\/\/cdn[^"]+)"/);
  return imgMatch?.[1] || '';
}

export type BrowseSort = 'trending' | 'popular' | 'recent' | 'top' | 'upcoming';

export async function browseAnime(sort: BrowseSort = 'trending', page = 1): Promise<{ ok: boolean; results?: AnimeSearchResult[]; hasNextPage?: boolean; error?: ApiError }> {
  // Try Kitsu first, fall back to anidb
  try {
    const offset = (page - 1) * 20;
    let path = '/anime';
    let params: Record<string, string | number | undefined> = { 'page[limit]': 20, 'page[offset]': offset };
    switch (sort) {
      case 'trending':
        params = { ...params, sort: '-userCount', 'filter[status]': 'current', 'filter[subtype]': 'TV' };
        break;
      case 'popular':
        params = { ...params, sort: '-userCount', 'filter[subtype]': 'TV' };
        break;
      case 'recent':
        params = { ...params, sort: '-startDate', 'filter[status]': 'current', 'filter[subtype]': 'TV' };
        break;
      case 'top':
        params = { ...params, sort: 'ratingRank', 'filter[subtype]': 'TV' };
        break;
      case 'upcoming':
        params = { ...params, sort: 'startDate', 'filter[status]': 'upcoming', 'filter[subtype]': 'TV' };
        break;
    }
    const json = await kitsuFetch(path, params);
    const data = Array.isArray(json.data) ? json.data : [];
    const filtered = (sort === 'recent' || sort === 'trending')
      ? data.filter(isJapaneseKitsu)
      : data;
    if (filtered.length > 0) return { ok: true, results: filtered.map(mapKitsuAnime), hasNextPage: !!json.links?.next };
  } catch { /* Kitsu down, fall through to anidb */ }

  return anidbBrowse(page);
}

export async function searchAnime(query: string, page = 1): Promise<{ ok: boolean; results?: AnimeSearchResult[]; hasNextPage?: boolean; error?: ApiError }> {
  // Try Kitsu first, fall back to anidb
  try {
    const offset = (page - 1) * 20;
    const json = await kitsuFetch('/anime', { 'filter[text]': query, 'page[limit]': 20, 'page[offset]': offset, sort: '-userCount' });
    const data = Array.isArray(json.data) ? json.data : [];
    if (data.length > 0) return { ok: true, results: data.map(mapKitsuAnime), hasNextPage: !!json.links?.next };
  } catch { /* Kitsu down, fall through to anidb */ }

  return anidbSearch(query);
}

export async function getAnimeDetail(
  id: number,
  fallbackTitle?: string,
  fallbackImage?: string,
): Promise<{ ok: boolean; anime?: AnimeDetail; error?: ApiError }> {
  // Try Kitsu first unless this is an anidb-only negative fallback ID.
  let base: AnimeSearchResult | null = null;
  let kitsuAttrs: Record<string, unknown> = {};
  let providerAliases: string[] = fallbackTitle ? [fallbackTitle] : [];
  if (id > 0) {
    try {
      const json = await kitsuFetch(`/anime/${id}`);
      const item = (!Array.isArray(json.data) ? json.data : null) as Record<string, unknown> | null;
      if (item) {
        base = mapKitsuAnime(item);
        kitsuAttrs = (item.attributes || {}) as Record<string, unknown>;
        providerAliases = [...new Set([...getKitsuAliases(item), ...providerAliases])];
      }
    } catch { /* Kitsu down */ }
  }

  if (base && !providerAliases.includes(base.title)) providerAliases.unshift(base.title);
  if (base?.titleJp && !providerAliases.includes(base.titleJp)) providerAliases.push(base.titleJp);
  if (!providerAliases.length) providerAliases = [String(Math.abs(id))];

  // Get anidb provider data using all known aliases
  let anidbId: string | undefined;
  let anidbSlug: string | undefined;
  let providerEpisodes: EpisodeInfo[] | undefined;
  try {
    const match = await findAnidbMatch(providerAliases);
    if (match) {
      anidbId = match.id;
      anidbSlug = match.slug;
      const epsResult = await getEpisodes(match.id);
      if (epsResult.ok && epsResult.episodes?.length) providerEpisodes = epsResult.episodes;

      // If Kitsu was down, build base from anidb
      if (!base) {
        base = mapAnidbToSearchResult(match, fallbackImage);
        if (fallbackTitle) base.title = fallbackTitle;
        base.episodes = providerEpisodes?.length || null;
      }
    }
  } catch { /* anidb also failed */ }

  if (!base) {
    // Both Kitsu and the first provider match failed — retry by the visible title.
    return anidbDetail(fallbackTitle || String(Math.abs(id)));
  }

  return {
    ok: true,
    anime: {
      ...base,
      studios: [],
      season: null,
      duration: (kitsuAttrs.episodeLength as number | null) || null,
      source: null,
      anidbId, anidbSlug, providerAliases, providerEpisodes,
    },
  };
}

// ── anidb.app search (HTML scraping) ──
function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function searchAnidb(query: string): Promise<AnimeResult[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const html = await anidbFetch(`${BASE}/browse?q=${encodeURIComponent(cleanQuery)}`);
      const results = parseAnidbHtml(html);
      if (results.length > 0) return results;
    } catch (error) {
      lastError = error;
    }
    if (attempt < 2) await wait(250 * (attempt + 1));
  }

  if (lastError) throw lastError;
  return [];
}

async function findAnidbMatch(aliases: string[]): Promise<AnimeResult | null> {
  const uniqueAliases = [...new Set(aliases.map((alias) => alias.trim()).filter(Boolean))];
  let firstResult: AnimeResult | null = null;

  for (const alias of uniqueAliases) {
    const results = await searchAnidb(alias);
    if (!results.length) continue;
    firstResult ||= results[0];

    const normalizedAlias = normalizeTitle(alias);
    const exact = results.find((result) => {
      const title = normalizeTitle(result.title);
      const slug = normalizeTitle(result.slug.replace(/-\d+$/, '').replace(/-/g, ' '));
      return title === normalizedAlias || slug === normalizedAlias;
    });
    if (exact) return exact;
  }

  return firstResult;
}

// ── anidb.app episodes ──
export async function getEpisodes(anidbId: string): Promise<{ ok: boolean; episodes?: EpisodeInfo[]; error?: ApiError }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = await anidbFetch(`${BASE}/api/frontend/anime/${anidbId}/episodes`);
      const data = JSON.parse(raw);
      const episodes: EpisodeInfo[] = (data.episodes || []).map((e: { id: number; number: number; filler: boolean }) => ({
        id: e.id,
        number: e.number,
        filler: e.filler || false,
      }));
      if (episodes.length > 0) return { ok: true, episodes };
    } catch (error) {
      lastError = error;
    }
    if (attempt < 2) await wait(250 * (attempt + 1));
  }

  return {
    ok: false,
    error: {
      type: 'ANIDB_ERROR',
      message: 'Failed to load episodes from anidb',
      technical: `anidb.app episodes API failed after retries: ${lastError instanceof Error ? lastError.message : String(lastError || 'empty response')}`,
    },
  };
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

    // Pick language: prefer the requested lang, then fallback to first available
    const chosen = languages.find(l => l.code === lang) || languages.find(l => l.code === 'eng') || languages[0];

    // Also return available languages so frontend can show sub/dub toggle
    const availableLangs = languages.map(l => ({ code: l.code, name: l.name }));

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
        currentLang: chosen.code,
        availableLangs,
      },
    };
  } catch (e) {
    return { ok: false, error: { type: 'ANIDB_ERROR', message: 'Failed to get stream', technical: `anidb stream error: ${e instanceof Error ? e.message : String(e)}` } };
  }
}

// ── Combined: find stream for AniList anime + episode number ──
export async function findStreamForAnime(
  metadataId: number,
  episodeNum: number,
  title: string,
  anidbIdHint?: string,
  lang?: string,
  aliases: string[] = []
): Promise<{ ok: boolean; stream?: StreamResult; error?: ApiError }> {
  try {
    // Step 1: Find anidb ID. Use every known alias and retry transient empty results.
    let anidbId = anidbIdHint;
    if (!anidbId) {
      const match = await findAnidbMatch([title, ...aliases]);
      if (match) anidbId = match.id;
    }

    if (!anidbId) {
      return {
        ok: false,
        error: {
          type: 'NOT_FOUND',
          message: `Could not match "${title}" to the streaming catalog`,
          technical: `anidb.app returned no results after retries. Metadata ID: ${metadataId}. Tried aliases: ${[title, ...aliases].join(', ')}`,
        },
      };
    }

    // Step 2: Get episodes. If a cached provider ID became stale, rematch aliases once.
    let epsResult = await getEpisodes(anidbId);
    if (!epsResult.ok || !epsResult.episodes) {
      const replacement = await findAnidbMatch([title, ...aliases]);
      if (replacement && replacement.id !== anidbId) {
        anidbId = replacement.id;
        epsResult = await getEpisodes(anidbId);
      }
    }
    if (!epsResult.ok || !epsResult.episodes) {
      return { ok: false, error: epsResult.error || { type: 'ANIDB_ERROR', message: 'Failed to load episodes', technical: 'Episodes request failed after rematching aliases' } };
    }

    const targetEp = epsResult.episodes.find(e => e.number === episodeNum);
    if (!targetEp) {
      return { ok: false, error: { type: 'NOT_FOUND', message: `Episode ${episodeNum} not found`, technical: `anidb.app has ${epsResult.episodes.length} episodes for anime ${anidbId}, but episode ${episodeNum} was not among them. Available: ${epsResult.episodes.map(e => e.number).join(', ').slice(0, 200)}` } };
    }

    // Step 3: Get stream
    return await getStream(targetEp.id, lang || 'jpn');
  } catch (e) {
    return { ok: false, error: { type: 'ANIDB_ERROR', message: 'Stream lookup failed', technical: `${e instanceof Error ? e.message : String(e)}` } };
  }
}
