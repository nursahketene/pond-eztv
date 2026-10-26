import { groupTorrents, parseSearchResults, Season, SearchResult, ShowInfo, summarizeShowInfo } from "./model";

// EZTV's domain has moved before (.ag -> .io -> .re -> eztvx.to, each time
// the old one was seized or went dark). If every fetch starts failing at
// once, check this first.
const EZTV_BASE = "https://eztvx.to";
const TVMAZE_BASE = "https://api.tvmaze.com";

const TORRENTS_PAGE_LIMIT = 100;
const TORRENTS_MAX_PAGES = 5; // caps a show at 500 releases - plenty for recent seasons
const MAX_TORRENTS_BYTES = 4 * 1024 * 1024;
const MAX_TVMAZE_BYTES = 512 * 1024;
const TORRENTS_TTL_MS = 10 * 60 * 1000;
const SHOW_INFO_TTL_MS = 30 * 60 * 1000;

async function fetchJson(url: string, host: string, maxBytes: number): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") throw new Error(`Connecting to ${host} timed out.`);
    throw new Error(`Couldn't reach ${host}. Check your internet connection.`);
  }
  if (!res.ok) throw new Error(`${host} returned an error (${res.status}).`);
  const text = await res.text();
  if (text.length > maxBytes) throw new Error(`The response from ${host} exceeded the size limit.`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Unexpected response from ${host}.`);
  }
}

type Cached<T> = { value: T; fetchedAt: number };
const torrentsCache = new Map<string, Cached<Season[]>>();
const showInfoCache = new Map<string, Cached<ShowInfo>>();

export async function fetchSeasons(imdbId: string): Promise<Season[]> {
  const cached = torrentsCache.get(imdbId);
  if (cached && Date.now() - cached.fetchedAt < TORRENTS_TTL_MS) return cached.value;

  const torrents: any[] = [];
  for (let page = 1; page <= TORRENTS_MAX_PAGES; page++) {
    const url = `${EZTV_BASE}/api/get-torrents?imdb_id=${encodeURIComponent(imdbId)}&limit=${TORRENTS_PAGE_LIMIT}&page=${page}`;
    let parsed: any;
    try {
      parsed = await fetchJson(url, "EZTV", MAX_TORRENTS_BYTES);
    } catch (e) {
      throw new Error(`${(e as Error).message} If this keeps happening, the eztvx.to domain may have moved again.`);
    }
    // EZTV omits `torrents` entirely for a show it has nothing for.
    const batch = Array.isArray(parsed?.torrents) ? parsed.torrents : [];
    torrents.push(...batch);
    const total = parseInt(String(parsed?.torrents_count), 10) || 0;
    if (batch.length === 0 || page * TORRENTS_PAGE_LIMIT >= total) break;
  }

  const seasons = groupTorrents(torrents);
  torrentsCache.set(imdbId, { value: seasons, fetchedAt: Date.now() });
  return seasons;
}

// TVMaze's imdb lookup is a bare redirect to /shows/{id} whose Location drops
// the query string, so ?embed=nextepisode can't ride along. Resolve the
// numeric id first, then ask for the embedded data directly.
export async function fetchShowInfo(imdbId: string): Promise<ShowInfo> {
  const cached = showInfoCache.get(imdbId);
  if (cached && Date.now() - cached.fetchedAt < SHOW_INFO_TTL_MS) return cached.value;

  const lookup = await fetchJson(`${TVMAZE_BASE}/lookup/shows?imdb=tt${encodeURIComponent(imdbId)}`, "TVMaze", MAX_TVMAZE_BYTES);
  if (!lookup?.id) throw new Error("TVMaze has no entry for this show.");
  const show = await fetchJson(`${TVMAZE_BASE}/shows/${lookup.id}?embed=nextepisode`, "TVMaze", MAX_TVMAZE_BYTES);

  const info = summarizeShowInfo(show);
  showInfoCache.set(imdbId, { value: info, fetchedAt: Date.now() });
  return info;
}

export async function searchShows(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const res = await fetch(`${TVMAZE_BASE}/search/shows?q=${encodeURIComponent(query)}`, {
    headers: { Accept: "application/json" },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`TVMaze search error (${res.status}).`);
  const text = await res.text();
  if (text.length > MAX_TVMAZE_BYTES) throw new Error("The search response exceeded the size limit.");
  return parseSearchResults(JSON.parse(text));
}
