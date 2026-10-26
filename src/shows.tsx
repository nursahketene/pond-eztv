import { Action, ActionPanel, Color, Icon, List } from "@vicinae/api";
import { useEffect, useState } from "react";
import { fetchShowInfo, searchShows } from "./lib/api";
import { episodeCode, formatPastDay, SearchResult, Show, ShowInfo } from "./lib/model";
import { Download, SHOWS_FILE, useDownloads, useShows } from "./lib/store";
import { SeasonsView, ShowLinks, TrackingActions } from "./lib/views";

// Next-air-date labels for the tracked list, fetched one show at a time:
// TVMaze rate-limits bursts, and each show costs two requests.
function useShowInfos(shows: Show[]) {
  const [infos, setInfos] = useState<Record<string, ShowInfo | "error">>({});
  const ids = shows.map((s) => s.imdbId).join(",");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const show of shows) {
        if (cancelled) return;
        let info: ShowInfo | "error";
        try {
          info = await fetchShowInfo(show.imdbId);
        } catch {
          info = "error";
        }
        if (!cancelled) setInfos((prev) => ({ ...prev, [show.imdbId]: info }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ids]);
  return infos;
}

function useSearch(query: string) {
  const [state, setState] = useState<{ results: SearchResult[]; error?: string; loading: boolean }>({
    results: [],
    loading: false,
  });
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setState({ results: [], loading: false });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: undefined }));
    // Debounce so every keystroke doesn't hit TVMaze.
    const timer = setTimeout(() => {
      searchShows(q, controller.signal).then(
        (results) => setState({ results, loading: false }),
        (e) => {
          if (!controller.signal.aborted) setState({ results: [], error: (e as Error).message, loading: false });
        },
      );
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  return state;
}

function lastDownloaded(downloads: Download[], imdbId: string): Download | undefined {
  return downloads
    .filter((d) => d.imdbId === imdbId)
    .reduce<Download | undefined>((best, d) => (!best || d.at > best.at ? d : best), undefined);
}

function ShowActions({ show }: { show: Show }) {
  return (
    <ActionPanel>
      <Action.Push title="Show Seasons" icon={Icon.BulletPoints} target={<SeasonsView show={show} />} />
      <TrackingActions show={show} />
      <ShowLinks show={show} />
      <ActionPanel.Section>
        <Action.Open title="Edit Shows File" icon={Icon.Pencil} target={SHOWS_FILE} />
      </ActionPanel.Section>
    </ActionPanel>
  );
}

export default function Shows() {
  const shows = useShows();
  const downloads = useDownloads();
  const [query, setQuery] = useState("");
  const search = useSearch(query);
  const infos = useShowInfos(shows);
  const searching = query.trim() !== "";
  const trackedIds = new Set(shows.map((s) => s.imdbId));

  return (
    <List
      searchText={query}
      onSearchTextChange={setQuery}
      isLoading={search.loading}
      searchBarPlaceholder="Search all shows to browse or track…"
    >
      {searching ? (
        <>
          {search.error && (
            <List.Item title="Search failed" subtitle={search.error} icon={{ source: Icon.Warning, tintColor: Color.Red }} />
          )}
          {!search.loading && !search.error && search.results.length === 0 && (
            <List.EmptyView title="No shows with an IMDb match found" icon={Icon.MagnifyingGlass} />
          )}
          <List.Section title="TVMaze Results">
            {search.results.map((r) => (
              <List.Item
                key={r.imdbId}
                title={r.name}
                subtitle={[r.status, r.premiered].filter(Boolean).join(" · ")}
                icon={trackedIds.has(r.imdbId) ? { source: Icon.Star, tintColor: Color.Yellow } : Icon.Video}
                accessories={trackedIds.has(r.imdbId) ? [{ tag: { value: "Tracked", color: Color.Yellow } }] : []}
                actions={<ShowActions show={r} />}
              />
            ))}
          </List.Section>
        </>
      ) : (
        <>
          <List.EmptyView
            title="No shows tracked yet"
            description="Type a show's name to search, then press Ctrl+B and choose Track Show."
            icon={Icon.Video}
          />
          <List.Section title="Tracked Shows">
            {shows.map((show) => {
              const info = infos[show.imdbId];
              const last = lastDownloaded(downloads, show.imdbId);
              return (
                <List.Item
                  key={show.imdbId}
                  title={show.name}
                  subtitle={
                    info === "error" ? "Next: Unavailable" : info ? `Next: ${info.label}` : "Next: Loading…"
                  }
                  icon={Icon.Video}
                  accessories={
                    last
                      ? [
                          {
                            tag: { value: `Last: ${episodeCode(last.season, last.episode)}`, color: Color.Green },
                            tooltip: `Downloaded ${formatPastDay(new Date(last.at))}`,
                          },
                        ]
                      : []
                  }
                  actions={<ShowActions show={show} />}
                />
              );
            })}
          </List.Section>
        </>
      )}
    </List>
  );
}
