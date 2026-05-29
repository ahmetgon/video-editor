import { useRef, useState } from "react";
import { api } from "../../api";
import type { MediaAsset, Track } from "../../types";
import { useTimeline } from "../../stores/timeline";

function formatDuration(ms: number | null) {
  if (!ms) return "--";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function MediaBin({
  projectId,
  media,
  onMediaChange,
}: {
  projectId: string;
  media: MediaAsset[];
  onMediaChange: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const tracks = useTimeline((s) => s.tracks);

  async function uploadFile(file: File) {
    setUploading(true);
    try {
      await api.uploadMedia(projectId, file);
      onMediaChange();
    } catch (e: any) {
      alert(e.message || "Yukleme hatasi");
    } finally {
      setUploading(false);
    }
  }

  async function addToTimeline(asset: MediaAsset) {
    // Find appropriate track
    const trackType = asset.type === "VIDEO" ? "VIDEO" : "AUDIO";
    let track = tracks.find((t: Track) => t.type === trackType);
    if (!track) {
      track = await api.addTrack(projectId, { type: trackType });
      useTimeline.getState().addTrackLocal(track);
    }

    // Calculate position: append after last clip on this track
    let startMs = 0;
    for (const c of track.clips) {
      const end = c.timelineStartMs + (c.mediaEndMs - c.mediaStartMs);
      if (end > startMs) startMs = end;
    }

    const clip = await api.addClip(track.id, {
      mediaAssetId: asset.id,
      timelineStartMs: startMs,
      mediaEndMs: asset.durationMs || 5000,
    });

    useTimeline.getState().addClipLocal(track.id, clip);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Medya</span>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded disabled:opacity-50"
        >
          {uploading ? "..." : "+ Ekle"}
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="video/*,audio/*,image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) uploadFile(f);
          e.target.value = "";
        }}
      />

      <div
        className={`flex-1 overflow-y-auto p-2 space-y-1 ${dragOver ? "bg-blue-950/20" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files[0];
          if (f) uploadFile(f);
        }}
      >
        {media.length === 0 && !uploading && (
          <p className="text-xs text-gray-600 text-center py-8">
            Video veya ses dosyasi yukleyin
          </p>
        )}

        {media.map((asset) => (
          <div
            key={asset.id}
            className="flex items-center gap-2 p-2 rounded bg-gray-900 hover:bg-gray-800 cursor-pointer group"
            onDoubleClick={() => addToTimeline(asset)}
            title="Cift tikla: timeline'a ekle"
          >
            {asset.type === "VIDEO" && asset.thumbnailPath ? (
              <img
                src={api.thumbnailUrl(asset.id)}
                alt=""
                className="w-12 h-8 object-cover rounded flex-shrink-0"
              />
            ) : (
              <div className={`w-12 h-8 rounded flex items-center justify-center text-xs flex-shrink-0 ${
                asset.type === "AUDIO" ? "bg-green-900/40 text-green-400" : "bg-purple-900/40 text-purple-400"
              }`}>
                {asset.type === "AUDIO" ? "♪" : "■"}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs truncate">{asset.filename}</p>
              <p className="text-[10px] text-gray-500">
                {formatDuration(asset.durationMs)} / {formatSize(asset.fileSize)}
                {asset.width && ` / ${asset.width}x${asset.height}`}
              </p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); addToTimeline(asset); }}
              className="text-[10px] px-1.5 py-0.5 bg-gray-700 hover:bg-gray-600 rounded opacity-0 group-hover:opacity-100"
            >
              +
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
