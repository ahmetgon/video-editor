import { execFile as execFileCb, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const exec = promisify(execFileCb);

/** Probe media file and return metadata */
export async function probeMedia(filePath) {
  const { stdout } = await exec("ffprobe", [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    filePath,
  ], { timeout: 30_000 });

  const info = JSON.parse(stdout);
  const video = info.streams?.find((s) => s.codec_type === "video");
  const audio = info.streams?.find((s) => s.codec_type === "audio");
  const durationMs = Math.round(parseFloat(info.format?.duration || "0") * 1000);

  return {
    durationMs,
    width: video ? parseInt(video.width) : null,
    height: video ? parseInt(video.height) : null,
    fps: video ? parseFps(video.r_frame_rate || video.avg_frame_rate) : null,
    sampleRate: audio ? parseInt(audio.sample_rate) : null,
    channels: audio ? parseInt(audio.channels) : null,
    hasVideo: !!video,
    hasAudio: !!audio,
    fileSize: parseInt(info.format?.size || "0"),
  };
}

function parseFps(frac) {
  if (!frac) return null;
  const [num, den] = frac.split("/").map(Number);
  if (!den) return num || null;
  return Math.round((num / den) * 100) / 100;
}

/** Generate poster thumbnail at given time */
export async function generateThumbnail(inputPath, outputPath, timeMs = 0) {
  const timeSec = (timeMs / 1000).toFixed(3);
  await exec("ffmpeg", [
    "-y", "-ss", timeSec, "-i", inputPath,
    "-vframes", "1", "-vf", "scale=320:-1",
    "-q:v", "5", outputPath,
  ], { timeout: 30_000 });
}

/** Generate waveform peaks JSON for audio */
export async function generateWaveform(inputPath, outputPath, peaksPerSecond = 100) {
  const sampleRate = peaksPerSecond * 2;
  const { stdout } = await exec("ffmpeg", [
    "-i", inputPath,
    "-ac", "1",
    "-ar", String(sampleRate),
    "-f", "f32le",
    "-acodec", "pcm_f32le",
    "pipe:1",
  ], { timeout: 120_000, maxBuffer: 50 * 1024 * 1024, encoding: "buffer" });

  const samples = new Float32Array(stdout.buffer, stdout.byteOffset, stdout.length / 4);
  const blockSize = 2;
  const peaks = [];

  for (let i = 0; i < samples.length; i += blockSize) {
    let max = 0;
    for (let j = i; j < i + blockSize && j < samples.length; j++) {
      const abs = Math.abs(samples[j]);
      if (abs > max) max = abs;
    }
    peaks.push(Math.round(max * 1000) / 1000);
  }

  fs.writeFileSync(outputPath, JSON.stringify({ peaksPerSecond, peaks }));
  return { peaksPerSecond, peakCount: peaks.length };
}

/** Generate thumbnail sprite sheet for video timeline */
export async function generateThumbnailStrip(inputPath, outputDir, intervalSec = 2) {
  fs.mkdirSync(outputDir, { recursive: true });
  await exec("ffmpeg", [
    "-i", inputPath,
    "-vf", `fps=1/${intervalSec},scale=160:-1`,
    "-q:v", "8",
    path.join(outputDir, "thumb_%04d.jpg"),
  ], { timeout: 300_000 });

  const files = fs.readdirSync(outputDir).filter((f) => f.startsWith("thumb_")).sort();
  return { count: files.length, intervalSec };
}

/** Extract audio from video as WAV */
export async function extractAudio(inputPath, outputPath) {
  await exec("ffmpeg", [
    "-y", "-i", inputPath,
    "-vn", "-acodec", "pcm_s16le", "-ar", "48000", "-ac", "2",
    outputPath,
  ], { timeout: 120_000 });
}

/**
 * Build FFmpeg volume expression from keyframes.
 * Keyframes: [{t: timeMs, v: volume}] relative to clip start.
 * Returns null if no keyframes / flat volume.
 */
function buildVolumeExpression(keyframesJson, baseVolume = 1.0) {
  let kf;
  try {
    kf = typeof keyframesJson === "string" ? JSON.parse(keyframesJson || "[]") : (keyframesJson || []);
  } catch { return null; }

  if (!kf || kf.length === 0) return null;

  // Sort by time
  kf = [...kf].sort((a, b) => a.t - b.t);

  // If only 1 keyframe, return constant volume
  if (kf.length === 1) return `${(kf[0].v * baseVolume).toFixed(4)}`;

  // Build nested if expression with linear interpolation
  // if(lt(t,t1), lerp(v0,v1,t), if(lt(t,t2), lerp(v1,v2,t), vLast))
  let expr = `${(kf[kf.length - 1].v * baseVolume).toFixed(4)}`;

  for (let i = kf.length - 2; i >= 0; i--) {
    const t1 = kf[i].t / 1000;
    const t2 = kf[i + 1].t / 1000;
    const v1 = kf[i].v * baseVolume;
    const v2 = kf[i + 1].v * baseVolume;
    const dt = t2 - t1;

    if (dt <= 0) continue;

    // Linear interp: v1 + (v2-v1) * (t-t1) / (t2-t1)
    const slope = ((v2 - v1) / dt).toFixed(6);
    const lerp = `(${v1.toFixed(4)}+${slope}*(t-${t1.toFixed(4)}))`;
    expr = `if(lt(t,${t2.toFixed(4)}),${lerp},${expr})`;
  }

  // Before first keyframe: use first keyframe's volume
  expr = `if(lt(t,${(kf[0].t / 1000).toFixed(4)}),${(kf[0].v * baseVolume).toFixed(4)},${expr})`;

  return expr;
}

/**
 * Export timeline to video file.
 *
 * @param {object} opts
 * @param {Array} opts.clips - Array of { filePath, mediaStartMs, mediaEndMs, timelineStartMs, trackType, hasVideo, hasAudio }
 * @param {number} opts.width
 * @param {number} opts.height
 * @param {number} opts.fps
 * @param {number} opts.durationMs
 * @param {string} opts.outputPath
 * @param {string} opts.quality - "low" | "medium" | "high"
 * @param {function} opts.onProgress - (percent: number) => void
 * @returns {Promise<string>} outputPath
 */
export function exportTimeline({
  clips,
  width,
  height,
  fps,
  durationMs,
  outputPath,
  quality = "medium",
  onProgress,
}) {
  return new Promise((resolve, reject) => {
    const totalDur = durationMs / 1000;

    // Separate video and audio clips
    const videoClips = clips
      .filter((c) => c.trackType === "VIDEO" && c.hasVideo)
      .sort((a, b) => a.timelineStartMs - b.timelineStartMs);

    // IMPORTANT: Only take audio from AUDIO tracks to avoid echo
    // (VIDEO track clips also have audio but we don't want double audio)
    const audioClips = clips
      .filter((c) => c.trackType === "AUDIO" && c.hasAudio)
      .sort((a, b) => a.timelineStartMs - b.timelineStartMs);

    // Deduplicate input files — map filePath → input index
    const inputFiles = [];
    const inputMap = new Map();

    for (const clip of [...videoClips, ...audioClips]) {
      if (!inputMap.has(clip.filePath)) {
        inputMap.set(clip.filePath, inputFiles.length + 2); // +2 for base video & silence
        inputFiles.push(clip.filePath);
      }
    }

    // Build ffmpeg args
    const args = ["-y"];

    // Input 0: base black canvas
    args.push("-f", "lavfi", "-i", `color=c=black:s=${width}x${height}:d=${totalDur}:r=${fps}`);
    // Input 1: silence
    args.push("-f", "lavfi", "-i", `anullsrc=channel_layout=stereo:sample_rate=48000:d=${totalDur}`);

    // Media file inputs
    for (const file of inputFiles) {
      args.push("-i", file);
    }

    // ---- Build filter_complex ----
    const filters = [];

    // Video overlay chain
    let lastVideoLabel = "0:v";
    if (videoClips.length > 0) {
      videoClips.forEach((clip, i) => {
        const idx = inputMap.get(clip.filePath);
        const startSec = (clip.mediaStartMs / 1000).toFixed(4);
        const endSec = (clip.mediaEndMs / 1000).toFixed(4);
        const offsetSec = (clip.timelineStartMs / 1000).toFixed(4);

        const vLabel = `v${i}`;
        const outLabel = i < videoClips.length - 1 ? `vtmp${i}` : "outv";

        // Trim → reset PTS → offset → scale to project dimensions
        filters.push(
          `[${idx}:v]trim=start=${startSec}:end=${endSec},` +
          `setpts=PTS-STARTPTS+${offsetSec}/TB,` +
          `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1[${vLabel}]`
        );
        // Overlay onto previous
        filters.push(
          `[${lastVideoLabel}][${vLabel}]overlay=eof_action=pass[${outLabel}]`
        );
        lastVideoLabel = outLabel;
      });
    } else {
      filters.push("[0:v]copy[outv]");
    }

    // Audio mix chain
    if (audioClips.length > 0) {
      const aLabels = [];
      audioClips.forEach((clip, i) => {
        const idx = inputMap.get(clip.filePath);
        const startSec = (clip.mediaStartMs / 1000).toFixed(4);
        const endSec = (clip.mediaEndMs / 1000).toFixed(4);
        const delayMs = Math.round(clip.timelineStartMs);
        const label = `a${i}`;

        // Build volume filter (with keyframe support)
        let volumeFilter = "";
        const volExpr = buildVolumeExpression(clip.volumeKeyframes, clip.volume);
        if (volExpr) {
          volumeFilter = `,volume='${volExpr}'`;
        } else if (clip.volume !== 1.0) {
          volumeFilter = `,volume=${clip.volume}`;
        }

        filters.push(
          `[${idx}:a]atrim=start=${startSec}:end=${endSec},` +
          `asetpts=PTS-STARTPTS${volumeFilter},` +
          `adelay=${delayMs}|${delayMs}[${label}]`
        );
        aLabels.push(`[${label}]`);
      });

      if (aLabels.length === 1) {
        filters.push(`${aLabels[0]}anull[outa]`);
      } else {
        filters.push(
          `${aLabels.join("")}amix=inputs=${aLabels.length}:duration=longest:normalize=0[outa]`
        );
      }
    } else {
      filters.push("[1:a]acopy[outa]");
    }

    const filterComplex = filters.join(";\n");
    args.push("-filter_complex", filterComplex);
    args.push("-map", "[outv]", "-map", "[outa]");
    args.push("-t", String(totalDur));

    // Codec / quality
    const presets = {
      low: ["-preset", "ultrafast", "-crf", "28"],
      medium: ["-preset", "medium", "-crf", "23"],
      high: ["-preset", "slow", "-crf", "18"],
    };
    args.push("-c:v", "libx264", ...(presets[quality] || presets.medium));
    args.push("-c:a", "aac", "-b:a", "192k");
    args.push("-movflags", "+faststart");
    args.push("-progress", "pipe:1"); // machine-readable progress on stdout
    args.push(outputPath);

    console.log("[export] ffmpeg", args.join(" ").slice(0, 300) + "...");

    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });

    let lastPercent = 0;
    let progressBuf = "";

    proc.stdout.on("data", (data) => {
      progressBuf += data.toString();
      const lines = progressBuf.split("\n");
      progressBuf = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("out_time_ms=")) {
          const timeUs = parseInt(line.split("=")[1]);
          if (timeUs > 0) {
            const percent = Math.min(99, Math.round((timeUs / 1_000_000) / totalDur * 100));
            if (percent > lastPercent) {
              lastPercent = percent;
              if (onProgress) onProgress(percent);
            }
          }
        }
      }
    });

    let stderr = "";
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
      // Keep stderr bounded
      if (stderr.length > 10_000) stderr = stderr.slice(-5000);
    });

    proc.on("close", (code) => {
      if (code === 0) {
        if (onProgress) onProgress(100);
        resolve(outputPath);
      } else {
        reject(new Error(`FFmpeg export failed (code ${code}): ${stderr.slice(-500)}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`FFmpeg spawn error: ${err.message}`));
    });
  });
}
