import { execFile as execFileCb } from "node:child_process";
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
  // Extract raw audio samples at low sample rate
  const sampleRate = peaksPerSecond * 2; // Nyquist
  const { stdout } = await exec("ffmpeg", [
    "-i", inputPath,
    "-ac", "1",
    "-ar", String(sampleRate),
    "-f", "f32le",
    "-acodec", "pcm_f32le",
    "pipe:1",
  ], { timeout: 120_000, maxBuffer: 50 * 1024 * 1024, encoding: "buffer" });

  // Convert float32 buffer to peaks array
  const samples = new Float32Array(stdout.buffer, stdout.byteOffset, stdout.length / 4);
  const blockSize = 2; // samples per peak (since sampleRate = peaksPerSecond * 2)
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
