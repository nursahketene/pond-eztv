import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { useSyncExternalStore } from "react";
import { Episode, Show, Variant } from "./model";

const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
const dataHome = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");

// Same format as oma-eztv's shows.json, so an old list can be copied over as-is.
export const SHOWS_FILE = join(configHome, "pond-eztv", "shows.json");
export const DOWNLOADS_FILE = join(dataHome, "pond-eztv", "downloads.json");

export type Download = {
  imdbId: string;
  showName: string;
  season: number;
  episode: number;
  quality: string;
  title: string;
  magnet: string;
  sizeBytes: number;
  // "clicked" = sent to the torrent client from here; "manual" = marked by hand
  source: "clicked" | "manual";
  at: number;
};

// A tiny JSON-file-backed store. Writes go through a temp file + rename so a
// crash mid-write never leaves a truncated file behind.
function createStore<T>(file: string, parse: (raw: unknown) => T, empty: T) {
  let value: T | undefined;
  const listeners = new Set<() => void>();

  function read(): T {
    try {
      return parse(JSON.parse(readFileSync(file, "utf8")));
    } catch {
      return empty;
    }
  }

  function get(): T {
    if (value === undefined) value = read();
    return value;
  }

  function set(next: T) {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
    renameSync(tmp, file);
    value = next;
    listeners.forEach((l) => l());
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { get, set, subscribe, use: () => useSyncExternalStore(subscribe, get) };
}

// Malformed entries are dropped rather than failing the whole list.
const showsStore = createStore<Show[]>(
  SHOWS_FILE,
  (raw) =>
    Array.isArray(raw)
      ? raw
          .filter((s) => s && typeof s.name === "string" && s.name.trim() && /^\d+$/.test(String(s.imdbId ?? "")))
          .map((s) => ({ name: s.name.trim(), imdbId: String(s.imdbId) }))
      : [],
  [],
);

const downloadsStore = createStore<Download[]>(
  DOWNLOADS_FILE,
  (raw) => (Array.isArray(raw) ? raw.filter((d) => d && typeof d.imdbId === "string" && d.season && d.episode) : []),
  [],
);

export const useShows = showsStore.use;
export const useDownloads = downloadsStore.use;

export function isTracked(imdbId: string): boolean {
  return showsStore.get().some((s) => s.imdbId === imdbId);
}

export function addShow(show: Show) {
  if (isTracked(show.imdbId)) return;
  showsStore.set([...showsStore.get(), { name: show.name, imdbId: show.imdbId }]);
}

export function removeShow(imdbId: string) {
  showsStore.set(showsStore.get().filter((s) => s.imdbId !== imdbId));
}

export function episodeKey(imdbId: string, season: number, episode: number): string {
  return `${imdbId}:${season}:${episode}`;
}

// Newest record per episode, for "is this downloaded?" lookups.
export function latestByEpisode(downloads: Download[]): Map<string, Download> {
  const map = new Map<string, Download>();
  for (const d of downloads) {
    const key = episodeKey(d.imdbId, d.season, d.episode);
    const prev = map.get(key);
    if (!prev || d.at > prev.at) map.set(key, d);
  }
  return map;
}

export function recordDownload(show: Show, ep: Episode, variant: Variant | null, source: Download["source"]) {
  const entry: Download = {
    imdbId: show.imdbId,
    showName: show.name,
    season: ep.season,
    episode: ep.episode,
    quality: variant?.quality ?? "",
    title: variant?.title ?? "",
    magnet: variant?.magnet ?? "",
    sizeBytes: variant?.sizeBytes ?? 0,
    source,
    at: Date.now(),
  };
  downloadsStore.set([...downloadsStore.get(), entry]);
}

export function forgetEpisode(imdbId: string, season: number, episode: number) {
  const key = episodeKey(imdbId, season, episode);
  downloadsStore.set(downloadsStore.get().filter((d) => episodeKey(d.imdbId, d.season, d.episode) !== key));
}

export function removeDownload(entry: Download) {
  downloadsStore.set(downloadsStore.get().filter((d) => d !== entry));
}

export function clearDownloads() {
  downloadsStore.set([]);
}
