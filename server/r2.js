import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import fs from "node:fs";
import path from "node:path";

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");

/** Check if R2 is configured */
export function isR2Enabled() {
  return !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME && R2_PUBLIC_URL);
}

let _client = null;
function getClient() {
  if (!_client) {
    _client = new S3Client({
      region: "auto",
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return _client;
}

/** Determine content type from extension */
function contentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".aac": "audio/aac",
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  return map[ext] || "application/octet-stream";
}

/**
 * Upload a file to R2.
 * @param {string} localPath - absolute path to the file on disk
 * @param {string} r2Key - object key in the bucket (e.g. "projects/abc/media/xyz/video.mp4")
 * @returns {Promise<string>} public URL of the uploaded object
 */
export async function uploadToR2(localPath, r2Key) {
  const client = getClient();
  const body = fs.createReadStream(localPath);
  const ct = contentType(localPath);

  await client.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: r2Key,
    Body: body,
    ContentType: ct,
  }));

  console.log(`[r2] Uploaded: ${r2Key} (${ct})`);
  return `${R2_PUBLIC_URL}/${r2Key}`;
}

/**
 * Delete an object from R2.
 * @param {string} r2Key
 */
export async function deleteFromR2(r2Key) {
  if (!r2Key) return;
  try {
    const client = getClient();
    await client.send(new DeleteObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: r2Key,
    }));
    console.log(`[r2] Deleted: ${r2Key}`);
  } catch (e) {
    console.warn(`[r2] Delete failed for ${r2Key}:`, e.message);
  }
}

/**
 * Build an R2 key for a media asset.
 * @param {string} projectId
 * @param {string} assetId
 * @param {string} filename
 */
export function buildR2Key(projectId, assetId, filename) {
  return `projects/${projectId}/media/${assetId}/${filename}`;
}

/**
 * Get the public URL for an R2 key.
 * @param {string} r2Key
 */
export function r2PublicUrl(r2Key) {
  if (!r2Key) return null;
  return `${R2_PUBLIC_URL}/${r2Key}`;
}
