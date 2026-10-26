// Pure data helpers, ported from oma-eztv's EztvModel.js - no I/O here.

export type Quality = "2160p" | "1080p" | "720p" | "480p" | "360p" | "SD";

export type Variant = {
  quality: Quality;
  rank: number;
  magnet: string;
  seeds: number;
  sizeBytes: number;
  title: string;
};

export type Episode = {
  season: number;
  episode: number;
  airedUnix: number;
  variants: Variant[];
  best: Variant | null;
};

export type Season = { season: number; episodes: Episode[] };

export type Show = { name: string; imdbId: string };

export type SearchResult = Show & { status: string; premiered: string };

export type ShowInfo = {
  label: string;
  airstamp: number;
  description: string;
  genres: string;
  network: string;
};

const QUALITY_RANK: Record<Quality, number> = { "2160p": 5, "1080p": 4, "720p": 3, "480p": 2, "360p": 1, SD: 0 };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// EZTV release titles carry the resolution as a plain substring
// ("The.Sinner.S04E08.1080p.HEVC..."); the API has no separate field for it.
export function extractQuality(text: string): Quality {
  const m = text.match(/(2160p|1080p|720p|480p|360p)/i);
  if (m) return m[1].toLowerCase() as Quality;
  if (/\b4k\b/i.test(text)) return "2160p";
  return "SD";
}

type RawTorrent = {
  season?: string;
  episode?: string;
  title?: string;
  filename?: string;
  magnet_url?: string;
  seeds?: number | string;
  size_bytes?: number | string;
  date_released_unix?: number | string;
};

// Groups EZTV's flat torrents[] into seasons -> episodes -> quality variants,
// picking the highest quality (ties broken by seeds) as each episode's best.
// Season packs and specials have no clean season/episode number and are dropped.
export function groupTorrents(torrents: RawTorrent[]): Season[] {
  const episodes = new Map<string, Episode>();

  for (const t of torrents) {
    const season = parseInt(String(t.season), 10);
    const episode = parseInt(String(t.episode), 10);
    if (!season || !episode) continue;
    const key = `${season}x${episode}`;
    let ep = episodes.get(key);
    if (!ep) {
      ep = { season, episode, airedUnix: 0, variants: [], best: null };
      episodes.set(key, ep);
    }
    const title = String(t.title || t.filename || "");
    const quality = extractQuality(title);
    ep.variants.push({
      quality,
      rank: QUALITY_RANK[quality],
      magnet: String(t.magnet_url || ""),
      seeds: parseInt(String(t.seeds), 10) || 0,
      sizeBytes: parseInt(String(t.size_bytes), 10) || 0,
      title,
    });
    const released = parseInt(String(t.date_released_unix), 10) || 0;
    if (released > ep.airedUnix) ep.airedUnix = released;
  }

  const seasons = new Map<number, Episode[]>();
  for (const ep of episodes.values()) {
    // Paginated fetches can overlap by a row at page boundaries.
    const seen = new Set<string>();
    ep.variants = ep.variants.filter((v) => {
      const k = `${v.quality}|${v.magnet}`;
      if (!v.magnet || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    ep.variants.sort((a, b) => b.rank - a.rank || b.seeds - a.seeds);
    ep.best = ep.variants[0] ?? null;
    seasons.set(ep.season, [...(seasons.get(ep.season) ?? []), ep]);
  }

  return [...seasons.entries()]
    .sort(([a], [b]) => b - a)
    .map(([season, eps]) => ({ season, episodes: eps.sort((a, b) => b.episode - a.episode) }));
}

// TVMaze search covers its whole catalog. Only results with an IMDb id are
// usable, since EZTV can only be looked up by imdb_id.
export function parseSearchResults(parsed: unknown): SearchResult[] {
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const entry of parsed) {
    const show = entry?.show;
    if (!show || typeof show.name !== "string") continue;
    const match = String(show.externals?.imdb ?? "").match(/^tt(\d+)$/i);
    if (!match || seen.has(match[1])) continue;
    seen.add(match[1]);
    results.push({
      name: show.name,
      imdbId: match[1],
      status: String(show.status || ""),
      premiered: show.premiered ? String(show.premiered).slice(0, 4) : "",
    });
  }
  return results;
}

// TVMaze omits _embedded once nothing is scheduled, which covers both
// "ended" and "on hiatus" - only the show's own status tells them apart.
export function summarizeShowInfo(show: any): ShowInfo {
  if (!show || typeof show !== "object") {
    return { label: "Unknown", airstamp: 0, description: "", genres: "", network: "" };
  }
  const next = show._embedded?.nextepisode;
  let label = show.status === "Ended" ? "Ended" : "Not yet scheduled";
  let airstamp = 0;
  if (next?.airstamp) {
    const d = new Date(next.airstamp);
    label = `${episodeCode(next.season, next.number)} – ${formatRelativeDateTime(d)}`;
    airstamp = d.getTime();
  }
  return {
    label,
    airstamp,
    description: stripHtml(show.summary),
    genres: Array.isArray(show.genres) ? show.genres.join(", ") : "",
    network: show.network?.name || show.webChannel?.name || "",
  };
}

export function stripHtml(html: unknown): string {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function episodeCode(season: number, episode: number): string {
  return `S${pad2(season)}E${pad2(episode)}`;
}

export function formatDate(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function formatTime(d: Date): string {
  const h12 = d.getHours() % 12 || 12;
  return `${h12}:${pad2(d.getMinutes())} ${d.getHours() >= 12 ? "PM" : "AM"}`;
}

function dayOffset(d: Date): number {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((day - today) / 86400000);
}

export function formatRelativeDateTime(d: Date): string {
  const diff = dayOffset(d);
  if (diff === 0) return `Today, ${formatTime(d)}`;
  if (diff === 1) return `Tomorrow, ${formatTime(d)}`;
  if (diff > 1 && diff < 7) return `${DAYS[d.getDay()]}, ${formatTime(d)}`;
  return `${formatDate(d)}, ${formatTime(d)}`;
}

// For past events (download history): "Today", "Yesterday", "Oct 12, 2026".
export function formatPastDay(d: Date): string {
  const diff = dayOffset(d);
  if (diff === 0) return "Today";
  if (diff === -1) return "Yesterday";
  return formatDate(d);
}

export function formatSize(bytes: number): string {
  if (bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return i === 0 ? `${v} ${units[i]}` : `${v.toFixed(1)} ${units[i]}`;
}
