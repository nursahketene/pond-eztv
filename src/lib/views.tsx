import { Action, ActionPanel, Color, Detail, Icon, Keyboard, List, open, showToast, Toast } from "@vicinae/api";
import { useEffect, useState } from "react";
import { fetchSeasons, fetchShowInfo } from "./api";
import { Episode, episodeCode, formatDate, formatPastDay, formatSize, Season, Show, ShowInfo, Variant } from "./model";
import {
  addShow,
  Download,
  episodeKey,
  forgetEpisode,
  latestByEpisode,
  recordDownload,
  removeShow,
  useDownloads,
  useShows,
} from "./store";

// Hands the magnet link to whatever is registered for magnet: links (Fragments
// here), the same as clicking one in a browser - nothing is downloaded by the
// extension itself. Every click is recorded in the download history.
export async function openMagnet(show: Show, ep: Episode, variant: Variant) {
  try {
    await open(variant.magnet);
  } catch (e) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Couldn't open the magnet link",
      message: "Is a torrent client set as the default for magnet links?",
    });
    return;
  }
  recordDownload(show, ep, variant, "clicked");
  await showToast({
    style: Toast.Style.Success,
    title: `Sent ${episodeCode(ep.season, ep.episode)} ${variant.quality} to your torrent client`,
  });
}

function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    load().then(
      (data) => !cancelled && setState({ data, loading: false }),
      (e) => !cancelled && setState({ error: (e as Error).message, loading: false }),
    );
    return () => {
      cancelled = true;
    };
  }, deps);
  return state;
}

export function useShowInfo(imdbId: string) {
  return useAsync(() => fetchShowInfo(imdbId), [imdbId]);
}

export function TrackingActions({ show }: { show: Show }) {
  const tracked = useShows().some((s) => s.imdbId === show.imdbId);
  return tracked ? (
    <Action
      title="Stop Tracking Show"
      icon={Icon.Trash}
      style="destructive"
      shortcut={Keyboard.Shortcut.Common.Remove}
      onAction={() => {
        removeShow(show.imdbId);
        showToast({ title: `Stopped tracking ${show.name}` });
      }}
    />
  ) : (
    <Action
      title="Track Show"
      icon={Icon.Plus}
      shortcut={Keyboard.Shortcut.Common.New}
      onAction={() => {
        addShow(show);
        showToast({ style: Toast.Style.Success, title: `Tracking ${show.name}` });
      }}
    />
  );
}

export function ShowLinks({ show }: { show: Show }) {
  return (
    <ActionPanel.Section>
      <Action.OpenInBrowser title="Open on IMDb" url={`https://www.imdb.com/title/tt${show.imdbId}/`} />
      <Action.OpenInBrowser title="Open on EZTV" url={`https://eztvx.to/search/?q=tt${show.imdbId}`} />
    </ActionPanel.Section>
  );
}

function ShowInfoDetail({ show, info }: { show: Show; info?: ShowInfo }) {
  const markdown = `# ${show.name}\n\n${info?.description || "_No description on TVMaze._"}`;
  return (
    <Detail
      navigationTitle={show.name}
      markdown={markdown}
      metadata={
        info && (
          <Detail.Metadata>
            <Detail.Metadata.Label title="Next episode" text={info.label} />
            {info.network && <Detail.Metadata.Label title="Network" text={info.network} />}
            {info.genres && <Detail.Metadata.Label title="Genres" text={info.genres} />}
          </Detail.Metadata>
        )
      }
      actions={
        <ActionPanel>
          <TrackingActions show={show} />
          <ShowLinks show={show} />
        </ActionPanel>
      }
    />
  );
}

export function SeasonsView({ show }: { show: Show }) {
  const { data: seasons, error, loading } = useAsync(() => fetchSeasons(show.imdbId), [show.imdbId]);
  const { data: info } = useShowInfo(show.imdbId);
  const downloaded = latestByEpisode(useDownloads());

  const infoActions = (
    <ActionPanel>
      <Action.Push title="Show Details" icon={Icon.Info01} target={<ShowInfoDetail show={show} info={info} />} />
      <TrackingActions show={show} />
      <ShowLinks show={show} />
    </ActionPanel>
  );

  return (
    <List navigationTitle={show.name} isLoading={loading} searchBarPlaceholder="Filter seasons…">
      <List.Section title="About">
        <List.Item
          title={info ? `Next: ${info.label}` : "Loading show info…"}
          subtitle={info ? [info.network, info.genres].filter(Boolean).join(" · ") : undefined}
          icon={Icon.Calendar}
          actions={infoActions}
        />
      </List.Section>
      {error && (
        <List.Item title="Couldn't load episodes" subtitle={error} icon={{ source: Icon.Warning, tintColor: Color.Red }} />
      )}
      {!loading && !error && seasons?.length === 0 && (
        <List.Item title={`No episodes found for ${show.name} on EZTV`} icon={Icon.XMarkCircle} />
      )}
      <List.Section title="Seasons">
        {seasons?.map((s) => {
          const got = s.episodes.filter((ep) => downloaded.has(episodeKey(show.imdbId, ep.season, ep.episode))).length;
          return (
            <List.Item
              key={s.season}
              title={`Season ${s.season}`}
              icon={got === s.episodes.length ? { source: Icon.CheckCircle, tintColor: Color.Green } : Icon.Folder}
              accessories={[
                ...(got > 0 ? [{ tag: { value: `${got}/${s.episodes.length} downloaded`, color: Color.Green } }] : []),
                { text: `${s.episodes.length} ${s.episodes.length === 1 ? "episode" : "episodes"}` },
              ]}
              actions={
                <ActionPanel>
                  <Action.Push title="Show Episodes" icon={Icon.BulletPoints} target={<EpisodesView show={show} season={s} />} />
                  <TrackingActions show={show} />
                  <ShowLinks show={show} />
                </ActionPanel>
              }
            />
          );
        })}
      </List.Section>
    </List>
  );
}

function variantLabel(v: Variant): string {
  return [v.quality, formatSize(v.sizeBytes), `${v.seeds} seeds`].filter(Boolean).join(" · ");
}

function downloadedLabel(d: Download): string {
  const when = formatPastDay(new Date(d.at));
  return d.source === "manual" ? `Marked ${when}` : `${d.quality} · ${when}`;
}

export function EpisodesView({ show, season }: { show: Show; season: Season }) {
  const downloaded = latestByEpisode(useDownloads());

  return (
    <List navigationTitle={`${show.name} › Season ${season.season}`} searchBarPlaceholder="Filter episodes…">
      {season.episodes.map((ep) => {
        const got = downloaded.get(episodeKey(show.imdbId, ep.season, ep.episode));
        const others = ep.variants.slice(1);
        return (
          <List.Item
            key={ep.episode}
            title={episodeCode(ep.season, ep.episode)}
            subtitle={ep.airedUnix ? formatDate(new Date(ep.airedUnix * 1000)) : undefined}
            keywords={[`e${ep.episode}`, String(ep.episode)]}
            icon={got ? { source: Icon.CheckCircle, tintColor: Color.Green } : Icon.Circle}
            accessories={[
              ...(got ? [{ tag: { value: downloadedLabel(got), color: Color.Green }, tooltip: "Already downloaded" }] : []),
              ...(ep.best ? [{ text: variantLabel(ep.best) }] : [{ text: "No link" }]),
            ]}
            actions={
              <ActionPanel>
                {ep.best && (
                  <Action
                    title={`Download ${ep.best.quality}`}
                    icon={Icon.Download}
                    onAction={() => openMagnet(show, ep, ep.best!)}
                  />
                )}
                {others.length > 0 && (
                  <ActionPanel.Section title="Other Qualities">
                    {others.map((v) => (
                      <Action
                        key={v.magnet}
                        title={`Download ${variantLabel(v)}`}
                        icon={Icon.Download}
                        onAction={() => openMagnet(show, ep, v)}
                      />
                    ))}
                  </ActionPanel.Section>
                )}
                <ActionPanel.Section>
                  {got ? (
                    <Action
                      title="Mark as Not Downloaded"
                      icon={Icon.Circle}
                      shortcut={{ modifiers: ["ctrl"], key: "m" }}
                      onAction={() => forgetEpisode(show.imdbId, ep.season, ep.episode)}
                    />
                  ) : (
                    <Action
                      title="Mark as Downloaded"
                      icon={Icon.CheckCircle}
                      shortcut={{ modifiers: ["ctrl"], key: "m" }}
                      onAction={() => recordDownload(show, ep, null, "manual")}
                    />
                  )}
                  {ep.best && (
                    <Action.CopyToClipboard
                      title="Copy Magnet Link"
                      content={ep.best.magnet}
                      shortcut={Keyboard.Shortcut.Common.Copy}
                    />
                  )}
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
