import { useEffect, useRef, useCallback } from "react";
import { useTimeline } from "../../stores/timeline";
import { api } from "../../api";
import type { Clip, Track } from "../../types";

const TRACK_HEIGHT = 60;
const TRACK_GAP = 2;
const RULER_HEIGHT = 28;
const TRACK_HEADER_WIDTH = 140;

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

export function TimelineCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    type: "move" | "trim-left" | "trim-right" | "scrub";
    clipId?: string;
    trackId?: string;
    startX: number;
    startMs: number;
    originalClip?: Clip;
  } | null>(null);

  const tracks = useTimeline((s) => s.tracks);
  const playheadMs = useTimeline((s) => s.playheadMs);
  const pxPerMs = useTimeline((s) => s.pxPerMs);
  const scrollX = useTimeline((s) => s.scrollX);
  const selectedClipId = useTimeline((s) => s.selectedClipId);
  const durationMs = useTimeline((s) => s.durationMs);

  const timeToX = useCallback((ms: number) => TRACK_HEADER_WIDTH + ms * pxPerMs - scrollX, [pxPerMs, scrollX]);
  const xToTime = useCallback((x: number) => (x - TRACK_HEADER_WIDTH + scrollX) / pxPerMs, [pxPerMs, scrollX]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = Math.max(container.clientHeight, RULER_HEIGHT + tracks.length * (TRACK_HEIGHT + TRACK_GAP) + 40);
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

    // Auto-scale ruler ticks
    let tickInterval = 1000;
    const intervals = [100, 250, 500, 1000, 2000, 5000, 10000, 30000, 60000];
    for (const iv of intervals) {
      if (iv * pxPerMs >= 60) { tickInterval = iv; break; }
    }

    const firstTick = Math.floor(startMs / tickInterval) * tickInterval;
    ctx.font = "10px system-ui";
    ctx.textAlign = "center";

    for (let ms = firstTick; ms < startMs + totalViewMs + tickInterval; ms += tickInterval) {
      const x = timeToX(ms);
      if (x < TRACK_HEADER_WIDTH || x > w) continue;

      ctx.strokeStyle = "#333";
      ctx.beginPath();
      ctx.moveTo(x, RULER_HEIGHT - 8);
      ctx.lineTo(x, RULER_HEIGHT);
      ctx.stroke();

      ctx.fillStyle = "#666";
      ctx.fillText(formatRulerTime(ms), x, RULER_HEIGHT - 12);
    }

    // Ruler line
    ctx.strokeStyle = "#333";
    ctx.beginPath();
    ctx.moveTo(0, RULER_HEIGHT);
    ctx.lineTo(w, RULER_HEIGHT);
    ctx.stroke();

    // ---- Track headers ----
    ctx.fillStyle = "#0d0d0d";
    ctx.fillRect(0, RULER_HEIGHT, TRACK_HEADER_WIDTH, h);

    tracks.forEach((track, i) => {
      const y = RULER_HEIGHT + i * (TRACK_HEIGHT + TRACK_GAP);
      const colors = COLORS[track.type];

      // Track background
      ctx.fillStyle = "#111";
      ctx.fillRect(TRACK_HEADER_WIDTH, y, w - TRACK_HEADER_WIDTH, TRACK_HEIGHT);

      // Track header
      ctx.fillStyle = "#0d0d0d";
      ctx.fillRect(0, y, TRACK_HEADER_WIDTH, TRACK_HEIGHT);

      // Track name
      ctx.fillStyle = colors.text;
      ctx.font = "11px system-ui";
      ctx.textAlign = "left";
      ctx.fillText(track.name, 8, y + 20);

      // Track type badge
      ctx.fillStyle = track.muted ? "#444" : colors.border;
      ctx.font = "9px system-ui";
      ctx.fillText(track.type, 8, y + 36);

      if (track.muted) {
        ctx.fillStyle = "#ef4444";
        ctx.fillText("MUTED", 50, y + 36);
      }

      // Separator
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

        if (x2 < TRACK_HEADER_WIDTH || x1 > w) continue;

        const isSelected = clip.id === selectedClipId;

        // Clip body
        ctx.fillStyle = colors.bg;
        ctx.fillRect(Math.max(x1, TRACK_HEADER_WIDTH), y + 4, Math.min(clipW, w - Math.max(x1, TRACK_HEADER_WIDTH)), TRACK_HEIGHT - 8);

        // Clip border
        ctx.strokeStyle = isSelected ? "#fff" : colors.border;
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.strokeRect(Math.max(x1, TRACK_HEADER_WIDTH), y + 4, Math.min(clipW, w - Math.max(x1, TRACK_HEADER_WIDTH)), TRACK_HEIGHT - 8);
        ctx.lineWidth = 1;

        // Clip label
        if (clipW > 40) {
          ctx.fillStyle = colors.text;
          ctx.font = "10px system-ui";
          ctx.textAlign = "left";
          const label = clip.name || clip.mediaAsset?.filename || "";
          const maxTextW = clipW - 12;
          ctx.save();
          ctx.beginPath();
          ctx.rect(Math.max(x1, TRACK_HEADER_WIDTH) + 4, y + 4, maxTextW, TRACK_HEIGHT - 8);
          ctx.clip();
          ctx.fillText(label, Math.max(x1, TRACK_HEADER_WIDTH) + 6, y + 20);

          // Duration
          ctx.fillStyle = "#666";
          ctx.font = "9px system-ui";
          ctx.fillText(`${(clipDur / 1000).toFixed(1)}s`, Math.max(x1, TRACK_HEADER_WIDTH) + 6, y + 34);
          ctx.restore();
        }

        // Trim handles
        if (isSelected && clipW > 20) {
          ctx.fillStyle = "#fff";
          ctx.fillRect(Math.max(x1, TRACK_HEADER_WIDTH), y + 4, 4, TRACK_HEIGHT - 8);
          ctx.fillRect(x2 - 4, y + 4, 4, TRACK_HEIGHT - 8);
        }
      }
    });

    // ---- Playhead ----
    const phX = timeToX(playheadMs);
    if (phX >= TRACK_HEADER_WIDTH && phX <= w) {
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(phX, 0);
      ctx.lineTo(phX, h);
      ctx.stroke();
      ctx.lineWidth = 1;

      // Playhead triangle
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.moveTo(phX - 6, 0);
      ctx.lineTo(phX + 6, 0);
      ctx.lineTo(phX, 10);
      ctx.closePath();
      ctx.fill();
    }

    // ---- Track header separator line ----
    ctx.strokeStyle = "#222";
    ctx.beginPath();
    ctx.moveTo(TRACK_HEADER_WIDTH, 0);
    ctx.lineTo(TRACK_HEADER_WIDTH, h);
    ctx.stroke();

  }, [tracks, playheadMs, pxPerMs, scrollX, selectedClipId, durationMs]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      // Trigger re-render via a dummy state update
      useTimeline.getState().setScrollX(useTimeline.getState().scrollX);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Mouse interactions
  function handleMouseDown(e: React.MouseEvent) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Click on ruler = scrub
    if (y < RULER_HEIGHT) {
      const ms = xToTime(x);
      useTimeline.getState().setPlayheadMs(Math.max(0, ms));
      dragRef.current = { type: "scrub", startX: x, startMs: ms };
      return;
    }

    // Find track
    const trackIndex = Math.floor((y - RULER_HEIGHT) / (TRACK_HEIGHT + TRACK_GAP));
    if (trackIndex < 0 || trackIndex >= tracks.length) {
      useTimeline.getState().selectClip(null);
      return;
    }

    const track = tracks[trackIndex];
    const clickMs = xToTime(x);

    // Find clip at position
    let clickedClip: Clip | null = null;
    for (const clip of track.clips) {
      const clipDur = clip.mediaEndMs - clip.mediaStartMs;
      if (clickMs >= clip.timelineStartMs && clickMs <= clip.timelineStartMs + clipDur) {
        clickedClip = clip;
        break;
      }
    }

    if (!clickedClip) {
      useTimeline.getState().selectClip(null);
      return;
    }

    useTimeline.getState().selectClip(clickedClip.id);

    // Determine drag type (trim handles = 8px from edges)
    const clipX1 = timeToX(clickedClip.timelineStartMs);
    const clipX2 = timeToX(clickedClip.timelineStartMs + (clickedClip.mediaEndMs - clickedClip.mediaStartMs));

    let dragType: "move" | "trim-left" | "trim-right" = "move";
    if (x - clipX1 < 8) dragType = "trim-left";
    else if (clipX2 - x < 8) dragType = "trim-right";

    dragRef.current = {
      type: dragType,
      clipId: clickedClip.id,
      trackId: track.id,
      startX: x,
      startMs: clickMs,
      originalClip: { ...clickedClip },
    };

    if (dragType !== "move") {
      useTimeline.getState().pushHistory();
    }
  }

  function handleMouseMove(e: React.MouseEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;

    if (drag.type === "scrub") {
      const ms = xToTime(x);
      useTimeline.getState().setPlayheadMs(Math.max(0, ms));
      return;
    }

    if (!drag.clipId || !drag.originalClip) return;
    const deltaMs = (x - drag.startX) / pxPerMs;
    const orig = drag.originalClip;
    const state = useTimeline.getState();

    if (drag.type === "move") {
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

  // Zoom with scroll wheel
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
        className="block cursor-default"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />
    </div>
  );
}
