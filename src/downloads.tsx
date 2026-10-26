import { Action, ActionPanel, Alert, Color, confirmAlert, Icon, List, open, showToast, Toast } from "@vicinae/api";
import { useState } from "react";
import { episodeCode, formatPastDay, formatSize, formatTime } from "./lib/model";
import { clearDownloads, Download, DOWNLOADS_FILE, removeDownload, useDownloads } from "./lib/store";
import { SeasonsView } from "./lib/views";

async function downloadAgain(d: Download) {
  try {
    await open(d.magnet);
    await showToast({ style: Toast.Style.Success, title: `Sent ${episodeCode(d.season, d.episode)} ${d.quality} again` });
  } catch {
    await showToast({ style: Toast.Style.Failure, title: "Couldn't open the magnet link" });
  }
}

async function confirmClear() {
  const ok = await confirmAlert({
    title: "Clear download history?",
    message: "Every episode will show as not downloaded again. This can't be undone.",
    primaryAction: { title: "Clear History", style: Alert.ActionStyle.Destructive },
  });
  if (ok) clearDownloads();
}

export default function Downloads() {
  const downloads = useDownloads();
  const [showFilter, setShowFilter] = useState("all");

  const showNames = new Map(downloads.map((d) => [d.imdbId, d.showName]));
  const filtered = downloads
    .filter((d) => showFilter === "all" || d.imdbId === showFilter)
    .sort((a, b) => b.at - a.at);

  // Sections by day: "Today", "Yesterday", "Oct 12, 2026", ...
  const byDay = new Map<string, Download[]>();
  for (const d of filtered) {
    const day = formatPastDay(new Date(d.at));
    byDay.set(day, [...(byDay.get(day) ?? []), d]);
  }

  return (
    <List
      searchBarPlaceholder="Filter downloads…"
      searchBarAccessory={
        <List.Dropdown tooltip="Show" value={showFilter} onChange={setShowFilter}>
          <List.Dropdown.Item title="All Shows" value="all" />
          {[...showNames.entries()]
            .sort(([, a], [, b]) => a.localeCompare(b))
            .map(([id, name]) => (
              <List.Dropdown.Item key={id} title={name} value={id} />
            ))}
        </List.Dropdown>
      }
    >
      <List.EmptyView
        title="Nothing downloaded yet"
        description="Episodes you send to your torrent client from EZTV Shows appear here."
        icon={Icon.Download}
      />
      {[...byDay.entries()].map(([day, items]) => (
        <List.Section key={day} title={day}>
          {items.map((d) => (
            <List.Item
              key={`${d.imdbId}:${d.season}:${d.episode}:${d.at}`}
              title={`${d.showName} ${episodeCode(d.season, d.episode)}`}
              subtitle={d.source === "manual" ? "Marked as downloaded" : d.title}
              keywords={[d.showName, episodeCode(d.season, d.episode)]}
              icon={{ source: Icon.CheckCircle, tintColor: Color.Green }}
              accessories={[
                ...(d.quality ? [{ tag: { value: d.quality, color: Color.Blue } }] : []),
                ...(d.sizeBytes ? [{ text: formatSize(d.sizeBytes) }] : []),
                { text: formatTime(new Date(d.at)) },
              ]}
              actions={
                <ActionPanel>
                  <Action.Push
                    title="Open Show"
                    icon={Icon.BulletPoints}
                    target={<SeasonsView show={{ name: d.showName, imdbId: d.imdbId }} />}
                  />
                  {d.magnet && <Action title="Download Again" icon={Icon.Download} onAction={() => downloadAgain(d)} />}
                  {d.magnet && <Action.CopyToClipboard title="Copy Magnet Link" content={d.magnet} />}
                  <ActionPanel.Section>
                    <Action
                      title="Remove from History"
                      icon={Icon.Trash}
                      style="destructive"
                      onAction={() => removeDownload(d)}
                    />
                    <Action title="Clear All History…" icon={Icon.Trash} style="destructive" onAction={confirmClear} />
                    <Action.Open title="Open History File" icon={Icon.BlankDocument} target={DOWNLOADS_FILE} />
                  </ActionPanel.Section>
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      ))}
    </List>
  );
}
