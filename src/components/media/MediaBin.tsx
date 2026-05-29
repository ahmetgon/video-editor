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
    const state = useTimeline.getState();
    const currentTracks = state.tracks;

    if (asset.type === "VIDEO") {
      // --- VIDEO with audio separation ---
      // Find or create video track
      let videoTrack = currentTracks.find((t: Track) => t.type === "VIDEO");
      if (!videoTrack) {
        videoTrack = await api.addTrack(projectId, { type: "VIDEO", name: "Video 1" });
        state.addTrackLocal(videoTrack);
      }

      // Calculate start: append after last clip on video track
      let startMs = 0;
      for (const c of videoTrack.clips) {
        const end = c.timelineStartMs + (c.mediaEndMs - c.mediaStartMs);
        if (end > startMs) startMs = end;
      }

      // Create video clip
      const videoClip = await api.addClip(videoTrack.id, {
        mediaAssetId: asset.id,
        timelineStartMs: startMs,
        mediaEndMs: asset.durationMs || 5000,
      });

      // If video has audio, also create audio clip on audio track
      const hasAudio = asset.sampleRate && asset.sampleRate > 0;
      if (hasAudio) {
        const freshTracks = useTimeline.getState().tracks;
        let audioTrack = freshTracks.find((t: Track) => t.type === "AUDIO");
        if (!audioTrack) {
          audioTrack = await api.addTrack(projectId, { type: "AUDIO", name: "Audio 1" });
          state.addTrackLocal(audioTrack);
        }

        const audioClip = await api.addClip(audioTrack.id, {
          mediaAssetId: asset.id,
          timelineStartMs: startMs, // Same start as video clip
          mediaEndMs: asset.durationMs || 5000,
          name: `${asset.filename} (audio)`,
        });

        // Add both clips as a batch (single undo step)
        state.addClipsBatch([
          { trackId: videoTrack.id, clip: videoClip },
          { trackId: audioTrack.id, clip: audioClip },
        ]);
      } else {
        state.addClipLocal(videoTrack.id, videoClip);
      }
    } else {
      // --- AUDIO / IMAGE ---
      const trackType = asset.type === "IMAGE" ? "VIDEO" : "AUDIO";
      let track = currentTracks.find((t: Track) => t.type === trackType);
      if (!track) {
        const name = trackType === "VIDEO" ? "Video 1" : "Audio 1";
        track = await api.addTrack(projectId, { type: trackType, name });
        state.addTrackLocal(track);
      }

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

      state.addClipLocal(track.id, clip);
    }
  }

  async function removeMedia(asset: MediaAsset) {
    if (!confirm(`"${asset.filename}" silinsin mi?`)) return;
    try {
      await api.deleteMedia(projectId, asset.id);
      onMediaChange();
    } catch (e: any) {
      alert(e.message || "Silme hatasi");
    }
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
            <div className="flex gap-0.5 opacity-0 group-hover:opacity-100">
              <button
                onClick={(e) => { e.stopPropagation(); addToTimeline(asset); }}
                className="text-[10px] px-1.5 py-0.5 bg-gray-700 hover:bg-gray-600 rounded"
                title="Timeline'a ekle"
              >
                +
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); removeMedia(asset); }}
                className="text-[10px] px-1.5 py-0.5 bg-gray-700 hover:bg-red-900/50 text-gray-400 hover:text-red-400 rounded"
                title="Medya sil"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
