import { useEffect, useRef, useState } from "react";
import { useTimeline } from "../../stores/timeline";
import { api } from "../../api";

function formatTimecode(ms: number) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const f = Math.floor((ms % 1000) / (1000 / 30));
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}

export function VideoPreview() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentAssetId, setCurrentAssetId] = useState<string | null>(null);
  const playheadMs = useTimeline((s) => s.playheadMs);
  const playing = useTimeline((s) => s.playing);
  const tracks = useTimeline((s) => s.tracks);
  const durationMs = useTimeline((s) => s.durationMs);
  const setPlaying = useTimeline((s) => s.setPlaying);

  // Find the video clip at current playhead position
  const videoTracks = tracks.filter((t) => t.type === "VIDEO");
  let activeClip = null;
  for (const track of videoTracks) {
    if (track.muted) continue;
    for (const clip of track.clips) {
      const timelineDur = (clip.mediaEndMs - clip.mediaStartMs) / (clip.speed || 1);
      if (playheadMs >= clip.timelineStartMs && playheadMs < clip.timelineStartMs + timelineDur) {
        activeClip = clip;
        break;
      }
    }
    if (activeClip) break;
  }

  // Update video element when active clip changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!activeClip) {
      if (currentAssetId) {
        video.pause();
        setCurrentAssetId(null);
      }
      return;
    }

    // Switch source if needed
    if (activeClip.mediaAssetId !== currentAssetId) {
      video.src = api.streamUrl(activeClip.mediaAssetId);
      setCurrentAssetId(activeClip.mediaAssetId);
    }

    // Seek to correct position within clip (speed maps timeline → media time)
    const clipSpeed = activeClip.speed || 1;
    const mediaTimeMs = activeClip.mediaStartMs + (playheadMs - activeClip.timelineStartMs) * clipSpeed;
    const mediaTimeSec = mediaTimeMs / 1000;

    // Set playback rate
    if (video.playbackRate !== clipSpeed) {
      video.playbackRate = clipSpeed;
    }

    if (!playing) {
      video.pause();
      if (Math.abs(video.currentTime - mediaTimeSec) > 0.05) {
        video.currentTime = mediaTimeSec;
      }
    }
  }, [activeClip?.id, activeClip?.mediaAssetId, currentAssetId, playing]);

  // Sync on playhead scrub (when not playing)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || playing || !activeClip) return;

    const clipSpeed = activeClip.speed || 1;
    const mediaTimeMs = activeClip.mediaStartMs + (playheadMs - activeClip.timelineStartMs) * clipSpeed;
    const mediaTimeSec = mediaTimeMs / 1000;
    if (Math.abs(video.currentTime - mediaTimeSec) > 0.05) {
      video.currentTime = mediaTimeSec;
    }
  }, [playheadMs, playing, activeClip?.id]);

  return (
    <div className="flex flex-col h-full bg-black">
      <div className="flex-1 flex items-center justify-center min-h-0">
        <video
          ref={videoRef}
          className="max-w-full max-h-full"
          playsInline
          muted
        />
        {!activeClip && (
          <div className="absolute text-gray-600 text-sm">Onizleme</div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 px-3 py-2 bg-gray-900 border-t border-gray-800">
        <button
          onClick={() => useTimeline.getState().setPlayheadMs(0)}
          className="text-xs text-gray-400 hover:text-white"
          title="Basa don"
        >
          ⏮
        </button>
        <button
          onClick={() => setPlaying(!playing)}
          className="text-sm px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded"
          title="Space"
        >
          {playing ? "⏸" : "▶"}
        </button>
        <div className="text-xs font-mono text-gray-400 flex-1">
          {formatTimecode(playheadMs)}
          <span className="text-gray-600 ml-2">/ {formatTimecode(durationMs)}</span>
        </div>
      </div>
    </div>
  );
}
