import { useEffect, useRef, useCallback, useState } from "react";
import { useTimeline } from "../../stores/timeline";
import { api } from "../../api";
import { ContextMenu, type ContextMenuState } from "./ContextMenu";
import type { Clip, VolumeKeyframe, WaveformData } from "../../types";

const TRACK_HEIGHT = 60;
const TRACK_GAP = 2;
const RULER_HEIGHT = 28;

const COLORS: Record<string, { bg: string; border: string; text: string }> = {
  VIDEO: { bg: "#1e3a5f", border: "#3b82f6", text: "#93c5fd" },
  AUDIO: { bg: "#1a3a2a", border: "#22c55e", text: "#86efac" },
};

function formatRulerTime(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}:${String(sec).padStart(2, "0")}` : `${sec}s`;
}

function parseKeyframes(clip: Clip): VolumeKeyframe[] {
  try {
    return JSON.parse(clip.volumeKeyframes || "[]");
  } catch {
    return [];
  }
}

/** Get interpolated volume at a given time (ms relative to clip start) */
function getVolumeAt(keyframes: VolumeKeyframe[], t: number, baseVolume: number): number {
  if (keyframes.length === 0) return baseVolume;
  if (keyframes.length === 1) return keyframes[0].v;
  const sorted = [...keyframes].sort((a, b) => a.t - b.t);
  if (t <= sorted[0].t) return sorted[0].v;
  if (t >= sorted[sorted.length - 1].t) return sorted[sorted.length - 1].v;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (t >= sorted[i].t && t <= sorted[i + 1].t) {
      const ratio = (t - sorted[i].t) / (sorted[i + 1].t - sorted[i].t);
      return sorted[i].v + (sorted[i + 1].v - sorted[i].v) * ratio;
    }
  }
  return baseVolume;
}

export function TimelineCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [waveformsVer, setWaveformsVer] = useState(0);
  const waveformCache = useRef<Map<string, WaveformData>>(new Map());
  const dragRef = useRef<{
    type: "move" | "trim-left" | "trim-right" | "scrub" | "volume-kf";
    clipId?: string;
    trackId?: string;
    startX: number;
    startMs: number;
    originalClip?: Clip;
    keyframeIndex?: number;
  } | null>(null);

  const tracks = useTimeline((s) => s.tracks);
  const playheadMs = useTimeline((s) => s.playheadMs);
  const pxPerMs = useTimeline((s) => s.pxPerMs);
  const scrollX = useTimeline((s) => s.scrollX);
  const selectedClipId = useTimeline((s) => s.selectedClipId);
  const durationMs = useTimeline((s) => s.durationMs);

  const timeToX = useCallback((ms: number) => ms * pxPerMs - scrollX, [pxPerMs, scrollX]);
  const xToTime = useCallback((x: number) => (x + scrollX) / pxPerMs, [pxPerMs, scrollX]);

  // Load waveforms for audio clips
  useEffect(() => {
    const assetsToLoad = new Set<string>();
    for (const track of tracks) {
      for (const clip of track.clips) {
        if (clip.mediaAsset?.waveformPath && !waveformCache.current.has(clip.mediaAssetId)) {
          assetsToLoad.add(clip.mediaAssetId);
        }
      }
    }
    for (const assetId of assetsToLoad) {
      fetch(api.waveformUrl(assetId))
        .then((r) => r.json())
        .then((data: WaveformData) => {
          waveformCache.current.set(assetId, data);
          setWaveformsVer((v) => v + 1);
        })
        .catch(() => {});
    }
  }, [tracks]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = Math.max(
      container.clientHeight,
      RULER_HEIGHT + tracks.length * (TRACK_HEIGHT + TRACK_GAP) + 40
    );
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // ---- Ruler ----
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, w, RULER_HEIGHT);

    const totalViewMs = w / pxPerMs;
    const startMs = scrollX / pxPerMs;

    let tickInterval = 1000;
    const intervals = [100, 250, 500, 1000, 2000, 5000, 10000, 30000, 60000];
    for (const iv of intervals) {
      if (iv * pxPerMs >= 60) {
        tickInterval = iv;
        break;
      }
    }

    const firstTick = Math.floor(startMs / tickInterval) * tickInterval;
    ctx.font = "10px system-ui";
    ctx.textAlign = "center";

    for (let ms = firstTick; ms < startMs + totalViewMs + tickInterval; ms += tickInterval) {
      const x = timeToX(ms);
      if (x < 0 || x > w) continue;
      ctx.strokeStyle = "#333";
      ctx.beginPath();
      ctx.moveTo(x, RULER_HEIGHT - 8);
      ctx.lineTo(x, RULER_HEIGHT);
      ctx.stroke();
      ctx.fillStyle = "#666";
      ctx.fillText(formatRulerTime(ms), x, RULER_HEIGHT - 12);
    }

    ctx.strokeStyle = "#333";
    ctx.beginPath();
    ctx.moveTo(0, RULER_HEIGHT);
    ctx.lineTo(w, RULER_HEIGHT);
    ctx.stroke();

    // ---- Track lanes + Clips ----
    tracks.forEach((track, i) => {
      const y = RULER_HEIGHT + i * (TRACK_HEIGHT + TRACK_GAP);
      const colors = COLORS[track.type];

      ctx.fillStyle = "#111";
      ctx.fillRect(0, y, w, TRACK_HEIGHT);

      ctx.strokeStyle = "#1a1a1a";
      ctx.beginPath();
      ctx.moveTo(0, y + TRACK_HEIGHT);
      ctx.lineTo(w, y + TRACK_HEIGHT);
      ctx.stroke();

      // ---- Clips ----
      for (const clip of track.clips) {
        const clipDur = clip.mediaEndMs - clip.mediaStartMs;
        const x1 = timeToX(clip.timelineStartMs);
        const x2 = timeToX(clip.timelineStartMs + clipDur);
        const clipW = x2 - x1;
        if (x2 < 0 || x1 > w) continue;

        const isSelected = clip.id === selectedClipId;
        const drawX = Math.max(x1, 0);
        const drawW = Math.min(x2, w) - drawX;
        const clipY = y + 4;
        const clipH = TRACK_HEIGHT - 8;

        // Clip body
        ctx.fillStyle = track.muted ? "#1a1a1a" : colors.bg;
        ctx.fillRect(drawX, clipY, drawW, clipH);

        // Waveform visualization
        const waveform = waveformCache.current.get(clip.mediaAssetId);
        if (waveform && waveform.peaks.length > 0) {
          const pps = waveform.peaksPerSecond;
          const centerY = clipY + clipH / 2;
          ctx.fillStyle = track.muted ? "#2a2a2a" : (colors.text + "25");

          for (let px = 0; px < drawW; px++) {
            const timeMs =
              clip.mediaStartMs + ((drawX + px - x1) / clipW) * clipDur;
            const peakIdx = Math.floor((timeMs / 1000) * pps);
            if (peakIdx >= 0 && peakIdx < waveform.peaks.length) {
              const amp = waveform.peaks[peakIdx] * clipH * 0.4;
              if (amp > 0.5) {
                ctx.fillRect(drawX + px, centerY - amp, 1, amp * 2);
              }
            }
          }
        }

        // Clip border
        ctx.strokeStyle = isSelected ? "#fff" : track.muted ? "#333" : colors.border;
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.strokeRect(drawX, clipY, drawW, clipH);
        ctx.lineWidth = 1;

        // Clip label
        if (clipW > 40) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(drawX + 4, clipY, drawW - 8, clipH);
          ctx.clip();
          ctx.fillStyle = track.muted ? "#555" : colors.text;
          ctx.font = "10px system-ui";
          ctx.textAlign = "left";
          const label = clip.name || clip.mediaAsset?.filename || "";
          ctx.fillText(label, drawX + 6, clipY + 14);
          ctx.fillStyle = "#555";
          ctx.font = "9px system-ui";
          ctx.fillText(`${(clipDur / 1000).toFixed(1)}s`, drawX + 6, clipY + 26);
          ctx.restore();
        }

        // Volume envelope line
        const keyframes = parseKeyframes(clip);
        if (isSelected || keyframes.length > 0) {
          const kf =
            keyframes.length > 0
              ? [...keyframes].sort((a, b) => a.t - b.t)
              : [
                  { t: 0, v: clip.volume },
                  { t: clipDur, v: clip.volume },
                ];

          ctx.beginPath();
          ctx.strokeStyle = "#f59e0b";
          ctx.lineWidth = 1.5;

          for (let ki = 0; ki < kf.length; ki++) {
            const kx = x1 + (kf[ki].t / clipDur) * clipW;
            const ky = clipY + clipH - kf[ki].v * clipH;
            if (ki === 0) ctx.moveTo(Math.max(kx, drawX), ky);
            else ctx.lineTo(kx, ky);
          }
          ctx.stroke();
          ctx.lineWidth = 1;

          // Keyframe dots (only when selected)
          if (isSelected && keyframes.length > 0) {
            for (const kfp of keyframes) {
              const kx = x1 + (kfp.t / clipDur) * clipW;
              const ky = clipY + clipH - kfp.v * clipH;
              if (kx < drawX - 4 || kx > drawX + drawW + 4) continue;

              ctx.beginPath();
              ctx.arc(kx, ky, 4, 0, Math.PI * 2);
              ctx.fillStyle = "#f59e0b";
              ctx.fill();
              ctx.strokeStyle = "#fff";
              ctx.lineWidth = 1;
              ctx.stroke();
            }
          }
        }

        // Trim handles
        if (isSelected && clipW > 20) {
          ctx.fillStyle = "#fff";
          ctx.fillRect(Math.max(x1, 0), clipY, 4, clipH);
          ctx.fillRect(Math.min(x2 - 4, w - 4), clipY, 4, clipH);
        }
      }
    });

    // ---- Playhead ----
    const phX = timeToX(playheadMs);
    if (phX >= 0 && phX <= w) {
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(phX, 0);
      ctx.lineTo(phX, h);
      ctx.stroke();
      ctx.lineWidth = 1;

      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.moveTo(phX - 6, 0);
      ctx.lineTo(phX + 6, 0);
      ctx.lineTo(phX, 10);
      ctx.closePath();
      ctx.fill();
    }
  }, [tracks, playheadMs, pxPerMs, scrollX, selectedClipId, durationMs, waveformsVer]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      useTimeline.getState().setScrollX(useTimeline.getState().scrollX);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Find clip at canvas position
  function findClipAt(
    x: number,
    y: number
  ): { clip: Clip; trackIndex: number } | null {
    const trackIndex = Math.floor((y - RULER_HEIGHT) / (TRACK_HEIGHT + TRACK_GAP));
    if (trackIndex < 0 || trackIndex >= tracks.length) return null;
    const track = tracks[trackIndex];
    const clickMs = xToTime(x);
    for (const clip of track.clips) {
      const clipDur = clip.mediaEndMs - clip.mediaStartMs;
      if (clickMs >= clip.timelineStartMs && clickMs <= clip.timelineStartMs + clipDur) {
        return { clip, trackIndex };
      }
    }
    return null;
  }

  // Check if near a volume keyframe dot
  function findKeyframeAt(
    clip: Clip,
    trackIndex: number,
    mouseX: number,
    mouseY: number
  ): number {
    const keyframes = parseKeyframes(clip);
    if (keyframes.length === 0) return -1;

    const clipDur = clip.mediaEndMs - clip.mediaStartMs;
    const x1 = timeToX(clip.timelineStartMs);
    const clipW = timeToX(clip.timelineStartMs + clipDur) - x1;
    const trackY = RULER_HEIGHT + trackIndex * (TRACK_HEIGHT + TRACK_GAP);
    const clipY = trackY + 4;
    const clipH = TRACK_HEIGHT - 8;

    for (let i = 0; i < keyframes.length; i++) {
      const kx = x1 + (keyframes[i].t / clipDur) * clipW;
      const ky = clipY + clipH - keyframes[i].v * clipH;
      if (Math.abs(mouseX - kx) < 7 && Math.abs(mouseY - ky) < 7) {
        return i;
      }
    }
    return -1;
  }

  // Mouse interactions
  function handleMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    setContextMenu(null);

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (y < RULER_HEIGHT) {
      const ms = xToTime(x);
      useTimeline.getState().setPlayheadMs(Math.max(0, ms));
      dragRef.current = { type: "scrub", startX: x, startMs: ms };
      return;
    }

    const result = findClipAt(x, y);
    if (!result) {
      useTimeline.getState().selectClip(null);
      const trackIndex = Math.floor((y - RULER_HEIGHT) / (TRACK_HEIGHT + TRACK_GAP));
      if (trackIndex >= 0 && trackIndex < tracks.length) {
        useTimeline.getState().selectTrack(tracks[trackIndex].id);
      }
      return;
    }

    const track = tracks[result.trackIndex];
    if (track.locked) return;

    // Check for volume keyframe drag (only on selected clip)
    if (result.clip.id === selectedClipId) {
      const kfIdx = findKeyframeAt(result.clip, result.trackIndex, x, y);
      if (kfIdx >= 0) {
        useTimeline.getState().pushHistory();
        dragRef.current = {
          type: "volume-kf",
          clipId: result.clip.id,
          trackId: track.id,
          startX: x,
          startMs: xToTime(x),
          originalClip: { ...result.clip },
          keyframeIndex: kfIdx,
        };
        return;
      }
    }

    useTimeline.getState().selectClip(result.clip.id);
    useTimeline.getState().selectTrack(track.id);

    const clipX1 = timeToX(result.clip.timelineStartMs);
    const clipX2 = timeToX(
      result.clip.timelineStartMs + (result.clip.mediaEndMs - result.clip.mediaStartMs)
    );

    let dragType: "move" | "trim-left" | "trim-right" = "move";
    if (x - clipX1 < 8) dragType = "trim-left";
    else if (clipX2 - x < 8) dragType = "trim-right";

    dragRef.current = {
      type: dragType,
      clipId: result.clip.id,
      trackId: track.id,
      startX: x,
      startMs: xToTime(x),
      originalClip: { ...result.clip },
    };

    if (dragType !== "move") {
      useTimeline.getState().pushHistory();
    }
  }

  function handleMouseMove(e: React.MouseEvent) {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (!drag) {
      // Update cursor
      const result = findClipAt(x, y);
      if (result) {
        // Check if near keyframe
        if (result.clip.id === selectedClipId) {
          const kfIdx = findKeyframeAt(result.clip, result.trackIndex, x, y);
          if (kfIdx >= 0) {
            canvas.style.cursor = "ns-resize";
            return;
          }
        }
        const clipX1 = timeToX(result.clip.timelineStartMs);
        const clipX2 = timeToX(
          result.clip.timelineStartMs + (result.clip.mediaEndMs - result.clip.mediaStartMs)
        );
        if (x - clipX1 < 8 || clipX2 - x < 8) {
          canvas.style.cursor = "col-resize";
        } else {
          canvas.style.cursor = "grab";
        }
      } else if (y < RULER_HEIGHT) {
        canvas.style.cursor = "text";
      } else {
        canvas.style.cursor = "default";
      }
      return;
    }

    if (drag.type === "scrub") {
      const ms = xToTime(x);
      useTimeline.getState().setPlayheadMs(Math.max(0, ms));
      return;
    }

    if (drag.type === "volume-kf" && drag.clipId && drag.keyframeIndex !== undefined) {
      canvas.style.cursor = "ns-resize";
      // Find the track Y and clip height
      const clip = tracks
        .flatMap((t) => t.clips)
        .find((c) => c.id === drag.clipId);
      if (!clip) return;

      const trackIdx = tracks.findIndex((t) => t.clips.some((c) => c.id === drag.clipId));
      const trackY = RULER_HEIGHT + trackIdx * (TRACK_HEIGHT + TRACK_GAP);
      const clipY = trackY + 4;
      const clipH = TRACK_HEIGHT - 8;

      // Map Y to volume (top=1, bottom=0)
      const vol = Math.max(0, Math.min(1, 1 - (y - clipY) / clipH));

      const keyframes = parseKeyframes(clip);
      if (drag.keyframeIndex < keyframes.length) {
        keyframes[drag.keyframeIndex].v = Math.round(vol * 100) / 100;
        useTimeline.getState().updateClipLocal(drag.clipId, {
          volumeKeyframes: JSON.stringify(keyframes),
        });
      }
      return;
    }

    if (!drag.clipId || !drag.originalClip) return;
    const deltaMs = (x - drag.startX) / pxPerMs;
    const orig = drag.originalClip;
    const state = useTimeline.getState();

    if (drag.type === "move") {
      canvas.style.cursor = "grabbing";
      state.updateClipLocal(drag.clipId, {
        timelineStartMs: Math.max(0, orig.timelineStartMs + deltaMs),
      });
    } else if (drag.type === "trim-left") {
      const newMediaStart = Math.max(0, orig.mediaStartMs + deltaMs);
      const newTimelineStart = orig.timelineStartMs + (newMediaStart - orig.mediaStartMs);
      if (newMediaStart < orig.mediaEndMs - 100) {
        state.updateClipLocal(drag.clipId, {
          mediaStartMs: newMediaStart,
          timelineStartMs: newTimelineStart,
        });
      }
    } else if (drag.type === "trim-right") {
      const newMediaEnd = Math.max(orig.mediaStartMs + 100, orig.mediaEndMs + deltaMs);
      const maxEnd = orig.mediaAsset?.durationMs || Infinity;
      state.updateClipLocal(drag.clipId, {
        mediaEndMs: Math.min(newMediaEnd, maxEnd),
      });
    }
  }

  function handleMouseUp() {
    const drag = dragRef.current;
    if (!drag) return;

    if (drag.type === "volume-kf" && drag.clipId) {
      const clip = tracks.flatMap((t) => t.clips).find((c) => c.id === drag.clipId);
      if (clip) {
        api.updateClip(drag.clipId, { volumeKeyframes: clip.volumeKeyframes || "[]" }).catch(() => {});
      }
    }

    if (drag.type === "move" && drag.clipId && drag.originalClip) {
      const clip = tracks.flatMap((t) => t.clips).find((c) => c.id === drag.clipId);
      if (clip && clip.timelineStartMs !== drag.originalClip.timelineStartMs) {
        useTimeline.getState().pushHistory();
        api.updateClip(drag.clipId, { timelineStartMs: clip.timelineStartMs }).catch(() => {});
      }
    }

    if ((drag.type === "trim-left" || drag.type === "trim-right") && drag.clipId) {
      const clip = tracks.flatMap((t) => t.clips).find((c) => c.id === drag.clipId);
      if (clip) {
        api.updateClip(drag.clipId, {
          timelineStartMs: clip.timelineStartMs,
          mediaStartMs: clip.mediaStartMs,
          mediaEndMs: clip.mediaEndMs,
        }).catch(() => {});
      }
    }

    dragRef.current = null;
  }

  // Double click → add volume keyframe
  function handleDoubleClick(e: React.MouseEvent) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const result = findClipAt(x, y);
    if (!result || result.clip.id !== selectedClipId) return;

    const clip = result.clip;
    const clipDur = clip.mediaEndMs - clip.mediaStartMs;
    const x1 = timeToX(clip.timelineStartMs);
    const clipW = timeToX(clip.timelineStartMs + clipDur) - x1;
    const trackY = RULER_HEIGHT + result.trackIndex * (TRACK_HEIGHT + TRACK_GAP);
    const clipY = trackY + 4;
    const clipH = TRACK_HEIGHT - 8;

    const t = Math.max(0, Math.min(clipDur, ((x - x1) / clipW) * clipDur));
    const v = Math.max(0, Math.min(1, 1 - (y - clipY) / clipH));

    const keyframes = parseKeyframes(clip);
    keyframes.push({ t: Math.round(t), v: Math.round(v * 100) / 100 });
    keyframes.sort((a, b) => a.t - b.t);

    useTimeline.getState().pushHistory();
    useTimeline.getState().updateClipLocal(clip.id, {
      volumeKeyframes: JSON.stringify(keyframes),
    });
    api.updateClip(clip.id, { volumeKeyframes: JSON.stringify(keyframes) }).catch(() => {});
  }

  // Context menu
  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const state = useTimeline.getState();
    const result = findClipAt(x, y);

    if (result) {
      state.selectClip(result.clip.id);
      const clipEnd =
        result.clip.timelineStartMs + (result.clip.mediaEndMs - result.clip.mediaStartMs);
      const canSplit =
        state.playheadMs > result.clip.timelineStartMs && state.playheadMs < clipEnd;

      // Check if near a volume keyframe for delete option
      const kfIdx = findKeyframeAt(result.clip, result.trackIndex, x, y);
      const keyframes = parseKeyframes(result.clip);

      const items = [
        {
          label: "✂  Playhead'de bol",
          shortcut: "S",
          disabled: !canSplit,
          onClick: () => {
            api
              .splitClip(result.clip.id, state.playheadMs)
              .then(({ left, right }) => {
                useTimeline.getState().splitClipLocal(result.clip.id, left, right);
              })
              .catch(() => {});
          },
        },
        {
          label: "✂  Tum klipleri bol",
          shortcut: "Shift+S",
          onClick: () => splitAllAtPlayhead(),
        },
        {
          label: "🗑  Sil",
          shortcut: "Del",
          danger: true,
          onClick: () => {
            api.deleteClip(result.clip.id).catch(() => {});
            useTimeline.getState().removeClipLocal(result.clip.id);
          },
        },
      ];

      // Volume keyframe actions
      if (kfIdx >= 0) {
        items.push({
          label: "🔶  Volume noktasini sil",
          shortcut: "",
          danger: true,
          onClick: () => {
            keyframes.splice(kfIdx, 1);
            const kfStr = JSON.stringify(keyframes);
            useTimeline.getState().pushHistory();
            useTimeline.getState().updateClipLocal(result.clip.id, { volumeKeyframes: kfStr });
            api.updateClip(result.clip.id, { volumeKeyframes: kfStr }).catch(() => {});
          },
        });
      }

      if (keyframes.length > 0) {
        items.push({
          label: "🔶  Tum volume noktalarini sil",
          shortcut: "",
          danger: false,
          onClick: () => {
            const kfStr = "[]";
            useTimeline.getState().pushHistory();
            useTimeline.getState().updateClipLocal(result.clip.id, { volumeKeyframes: kfStr });
            api.updateClip(result.clip.id, { volumeKeyframes: kfStr }).catch(() => {});
          },
        });
      }

      setContextMenu({ x: e.clientX, y: e.clientY, items });
    } else {
      const trackIndex = Math.floor((y - RULER_HEIGHT) / (TRACK_HEIGHT + TRACK_GAP));
      if (trackIndex >= 0 && trackIndex < tracks.length) {
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          items: [
            {
              label: "✂  Tum klipleri bol",
              shortcut: "Shift+S",
              onClick: () => splitAllAtPlayhead(),
            },
          ],
        });
      }
    }
  }

  async function splitAllAtPlayhead() {
    const state = useTimeline.getState();
    const ph = state.playheadMs;
    const clipsToSplit = state.tracks.flatMap((t) => t.clips).filter((clip) => {
      const clipEnd = clip.timelineStartMs + (clip.mediaEndMs - clip.mediaStartMs);
      return ph > clip.timelineStartMs && ph < clipEnd;
    });
    for (const clip of clipsToSplit) {
      try {
        const { left, right } = await api.splitClip(clip.id, ph);
        useTimeline.getState().splitClipLocal(clip.id, left, right);
      } catch {}
    }
  }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    const state = useTimeline.getState();
    if (e.ctrlKey || e.metaKey) {
      const factor = e.deltaY > 0 ? 0.85 : 1.18;
      state.setZoom(state.pxPerMs * factor);
    } else {
      state.setScrollX(state.scrollX + e.deltaX + e.deltaY);
    }
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-hidden bg-gray-950 relative">
      <canvas
        ref={canvasRef}
        className="block"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        onWheel={handleWheel}
      />
      {contextMenu && (
        <ContextMenu {...contextMenu} onClose={() => setContextMenu(null)} />
      )}
    </div>
  );
}
