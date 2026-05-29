import express from "express";
import multer from "multer";
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import session from "express-session";
import passport from "passport";
import GoogleStrategy from "passport-google-oauth20";
import { probeMedia, generateThumbnail, generateWaveform, exportTimeline } from "./ffmpeg.js";
import { emitProgress, onProgress } from "./events.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const PORT = Number(process.env.PORT || 3040);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));
const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE_MB || 2000) * 1024 * 1024;
const DUBBING_API = (process.env.DUBBING_API_URL || "https://dub.ahmetgo.com").replace(/\/$/, "");

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const ALLOWED_EMAIL = process.env.ALLOWED_EMAIL || "gonulkirmaza@gmail.com";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const BASE_URL = process.env.BASE_URL || "https://videoedit.ahmetgo.com";

fs.mkdirSync(path.join(DATA_DIR, "projects"), { recursive: true });

let _prisma = null;
function getPrisma() {
  if (!_prisma) _prisma = new PrismaClient();
  return _prisma;
}

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "5mb" }));

// ---- Auth ----
const authEnabled = !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);

if (authEnabled) {
  app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: true, httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: "lax" },
  }));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((user, done) => done(null, user));

  passport.use(new GoogleStrategy.Strategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: `${BASE_URL}/auth/google/callback`,
  }, (_at, _rt, profile, done) => {
    const email = profile.emails?.[0]?.value;
    if (!email || email.toLowerCase() !== ALLOWED_EMAIL.toLowerCase()) {
      return done(null, false);
    }
    done(null, { id: profile.id, email, name: profile.displayName, photo: profile.photos?.[0]?.value });
  }));

  app.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));
  app.get("/auth/google/callback",
    passport.authenticate("google", { failureRedirect: "/auth/denied" }),
    (_req, res) => res.redirect("/"),
  );
  app.get("/auth/denied", (_req, res) => {
    res.status(403).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Erisim Engellendi</title>
    <style>body{background:#0a0a0a;color:#fff;font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}
    .c{text-align:center} a{color:#3b82f6}</style></head>
    <body><div class="c"><h1>Erisim Engellendi</h1><p style="color:#888">Bu hesapla giris yapilamaz.</p><a href="/auth/google">Baska hesapla dene</a></div></body></html>`);
  });
  app.get("/auth/logout", (req, res) => { req.logout(() => res.redirect("/")); });
  app.get("/api/auth/me", (req, res) => {
    if (req.isAuthenticated()) return res.json(req.user);
    res.status(401).json({ error: "not authenticated" });
  });
  app.use("/api", (req, res, next) => {
    if (req.path === "/auth/me") return next();
    if (!req.isAuthenticated()) return res.status(401).json({ error: "login required" });
    next();
  });
  console.log(`[ve] Auth enabled — only ${ALLOWED_EMAIL}`);
} else {
  app.get("/api/auth/me", (_req, res) => res.json({ email: "local", name: "Local" }));
  console.log("[ve] Auth disabled");
}

// ---- File uploads ----
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const tmp = path.join(DATA_DIR, "uploads");
    fs.mkdirSync(tmp, { recursive: true });
    cb(null, tmp);
  },
  filename: (_req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: MAX_FILE_SIZE } });

// ---- Projects CRUD ----
app.post("/api/projects", async (req, res) => {
  try {
    const { title, width, height, fps } = req.body;
    const project = await getPrisma().project.create({
      data: {
        title: title || "Yeni Proje",
        width: width || 1920,
        height: height || 1080,
        fps: fps || 30,
        tracks: {
          create: [
            { name: "Video 1", type: "VIDEO", order: 0 },
            { name: "Audio 1", type: "AUDIO", order: 1 },
          ],
        },
      },
      include: { tracks: true, media: true },
    });
    res.status(201).json(project);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/projects", async (_req, res) => {
  try {
    const projects = await getPrisma().project.findMany({
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { media: true, tracks: true } } },
    });
    res.json(projects);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/projects/:id", async (req, res) => {
  try {
    const project = await getPrisma().project.findUnique({
      where: { id: req.params.id },
      include: {
        media: { orderBy: { createdAt: "desc" } },
        tracks: {
          orderBy: { order: "asc" },
          include: { clips: { include: { mediaAsset: true } } },
        },
      },
    });
    if (!project) return res.status(404).json({ error: "proje bulunamadi" });
    res.json(project);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.patch("/api/projects/:id", async (req, res) => {
  try {
    const data = {};
    if (req.body.title !== undefined) data.title = req.body.title;
    if (req.body.width !== undefined) data.width = req.body.width;
    if (req.body.height !== undefined) data.height = req.body.height;
    if (req.body.fps !== undefined) data.fps = req.body.fps;
    if (req.body.durationMs !== undefined) data.durationMs = req.body.durationMs;
    const updated = await getPrisma().project.update({ where: { id: req.params.id }, data });
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.delete("/api/projects/:id", async (req, res) => {
  try {
    const prisma = getPrisma();
    const project = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!project) return res.status(404).json({ error: "proje bulunamadi" });
    await prisma.project.delete({ where: { id: req.params.id } });
    const projDir = path.join(DATA_DIR, "projects", req.params.id);
    fs.rmSync(projDir, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ---- Media upload + processing ----
app.post("/api/projects/:id/media", upload.single("file"), async (req, res) => {
  try {
    const prisma = getPrisma();
    const project = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!project) return res.status(404).json({ error: "proje bulunamadi" });
    if (!req.file) return res.status(400).json({ error: "dosya gerekli" });

    const projDir = path.join(DATA_DIR, "projects", project.id, "media");
    fs.mkdirSync(projDir, { recursive: true });

    // Move file to project directory
    const dest = path.join(projDir, req.file.filename);
    fs.renameSync(req.file.path, dest);

    // Probe metadata
    const meta = await probeMedia(dest);

    // Determine type
    let type = "AUDIO";
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (meta.hasVideo || [".mp4", ".mov", ".mkv", ".avi", ".webm"].includes(ext)) type = "VIDEO";
    else if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"].includes(ext)) type = "IMAGE";

    // Generate thumbnail for video
    let thumbnailPath = null;
    if (type === "VIDEO") {
      thumbnailPath = path.join(projDir, `${req.file.filename}_thumb.jpg`);
      await generateThumbnail(dest, thumbnailPath).catch(() => { thumbnailPath = null; });
    }

    // Generate waveform for video/audio
    let waveformPath = null;
    if (meta.hasAudio) {
      waveformPath = path.join(projDir, `${req.file.filename}_waveform.json`);
      await generateWaveform(dest, waveformPath).catch(() => { waveformPath = null; });
    }

    const asset = await prisma.mediaAsset.create({
      data: {
        projectId: project.id,
        filename: req.file.originalname,
        filePath: dest,
        type,
        durationMs: meta.durationMs || null,
        width: meta.width,
        height: meta.height,
        fps: meta.fps,
        sampleRate: meta.sampleRate,
        channels: meta.channels,
        fileSize: meta.fileSize || req.file.size,
        waveformPath,
        thumbnailPath,
      },
    });

    res.status(201).json(asset);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/projects/:id/media", async (req, res) => {
  try {
    const media = await getPrisma().mediaAsset.findMany({
      where: { projectId: req.params.id },
      orderBy: { createdAt: "desc" },
    });
    res.json(media);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.delete("/api/projects/:id/media/:mid", async (req, res) => {
  try {
    const prisma = getPrisma();
    const asset = await prisma.mediaAsset.findUnique({ where: { id: req.params.mid } });
    if (!asset || asset.projectId !== req.params.id) return res.status(404).json({ error: "medya bulunamadi" });
    await prisma.mediaAsset.delete({ where: { id: asset.id } });
    if (asset.filePath && fs.existsSync(asset.filePath)) fs.unlinkSync(asset.filePath);
    if (asset.thumbnailPath && fs.existsSync(asset.thumbnailPath)) fs.unlinkSync(asset.thumbnailPath);
    if (asset.waveformPath && fs.existsSync(asset.waveformPath)) fs.unlinkSync(asset.waveformPath);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ---- Serve media files ----
app.get("/media/:assetId/stream", async (req, res) => {
  try {
    const asset = await getPrisma().mediaAsset.findUnique({ where: { id: req.params.assetId } });
    if (!asset || !fs.existsSync(asset.filePath)) return res.status(404).json({ error: "dosya yok" });

    const stat = fs.statSync(asset.filePath);
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Content-Type": asset.type === "VIDEO" ? "video/mp4" : "audio/wav",
      });
      fs.createReadStream(asset.filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": stat.size,
        "Content-Type": asset.type === "VIDEO" ? "video/mp4" : "audio/wav",
        "Accept-Ranges": "bytes",
      });
      fs.createReadStream(asset.filePath).pipe(res);
    }
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/media/:assetId/thumbnail", async (req, res) => {
  try {
    const asset = await getPrisma().mediaAsset.findUnique({ where: { id: req.params.assetId } });
    if (!asset?.thumbnailPath || !fs.existsSync(asset.thumbnailPath)) {
      return res.status(404).json({ error: "thumbnail yok" });
    }
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    fs.createReadStream(asset.thumbnailPath).pipe(res);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/media/:assetId/waveform", async (req, res) => {
  try {
    const asset = await getPrisma().mediaAsset.findUnique({ where: { id: req.params.assetId } });
    if (!asset?.waveformPath || !fs.existsSync(asset.waveformPath)) {
      return res.status(404).json({ error: "waveform yok" });
    }
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, max-age=86400");
    fs.createReadStream(asset.waveformPath).pipe(res);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ---- Tracks CRUD ----
app.post("/api/projects/:id/tracks", async (req, res) => {
  try {
    const prisma = getPrisma();
    const count = await prisma.track.count({ where: { projectId: req.params.id } });
    const track = await prisma.track.create({
      data: {
        projectId: req.params.id,
        name: req.body.name || `Track ${count + 1}`,
        type: req.body.type || "AUDIO",
        order: count,
      },
      include: { clips: true },
    });
    res.status(201).json(track);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.patch("/api/tracks/:id", async (req, res) => {
  try {
    const data = {};
    if (req.body.name !== undefined) data.name = req.body.name;
    if (req.body.volume !== undefined) data.volume = req.body.volume;
    if (req.body.muted !== undefined) data.muted = req.body.muted;
    if (req.body.locked !== undefined) data.locked = req.body.locked;
    if (req.body.order !== undefined) data.order = req.body.order;
    const track = await getPrisma().track.update({ where: { id: req.params.id }, data });
    res.json(track);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.delete("/api/tracks/:id", async (req, res) => {
  try {
    await getPrisma().track.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ---- Clips CRUD ----
app.post("/api/tracks/:trackId/clips", async (req, res) => {
  try {
    const { mediaAssetId, timelineStartMs, mediaStartMs, mediaEndMs, name, volume } = req.body;
    const clip = await getPrisma().clip.create({
      data: {
        trackId: req.params.trackId,
        mediaAssetId,
        timelineStartMs: timelineStartMs || 0,
        mediaStartMs: mediaStartMs || 0,
        mediaEndMs,
        name: name || "",
        volume: volume ?? 1.0,
      },
      include: { mediaAsset: true },
    });
    res.status(201).json(clip);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.patch("/api/clips/:id", async (req, res) => {
  try {
    const data = {};
    if (req.body.trackId !== undefined) data.trackId = req.body.trackId;
    if (req.body.timelineStartMs !== undefined) data.timelineStartMs = req.body.timelineStartMs;
    if (req.body.mediaStartMs !== undefined) data.mediaStartMs = req.body.mediaStartMs;
    if (req.body.mediaEndMs !== undefined) data.mediaEndMs = req.body.mediaEndMs;
    if (req.body.name !== undefined) data.name = req.body.name;
    if (req.body.volume !== undefined) data.volume = req.body.volume;
    if (req.body.volumeKeyframes !== undefined) {
      data.volumeKeyframes = typeof req.body.volumeKeyframes === "string"
        ? req.body.volumeKeyframes
        : JSON.stringify(req.body.volumeKeyframes);
    }
    const clip = await getPrisma().clip.update({
      where: { id: req.params.id },
      data,
      include: { mediaAsset: true },
    });
    res.json(clip);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.delete("/api/clips/:id", async (req, res) => {
  try {
    await getPrisma().clip.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Split clip at a given time
app.post("/api/clips/:id/split", async (req, res) => {
  try {
    const prisma = getPrisma();
    const clip = await prisma.clip.findUnique({ where: { id: req.params.id }, include: { mediaAsset: true } });
    if (!clip) return res.status(404).json({ error: "clip bulunamadi" });

    const splitAtMs = req.body.timeMs;
    if (splitAtMs == null) return res.status(400).json({ error: "timeMs gerekli" });

    const clipDuration = clip.mediaEndMs - clip.mediaStartMs;
    const relativeMs = splitAtMs - clip.timelineStartMs;
    if (relativeMs <= 0 || relativeMs >= clipDuration) {
      return res.status(400).json({ error: "split noktasi clip sinirlarinin disinda" });
    }

    const mediaSplitMs = clip.mediaStartMs + relativeMs;

    // Update original clip (left part)
    await prisma.clip.update({
      where: { id: clip.id },
      data: { mediaEndMs: mediaSplitMs },
    });

    // Create new clip (right part)
    const newClip = await prisma.clip.create({
      data: {
        trackId: clip.trackId,
        mediaAssetId: clip.mediaAssetId,
        name: clip.name,
        timelineStartMs: splitAtMs,
        mediaStartMs: mediaSplitMs,
        mediaEndMs: clip.mediaEndMs,
        volume: clip.volume,
      },
      include: { mediaAsset: true },
    });

    const updated = await prisma.clip.findUnique({
      where: { id: clip.id },
      include: { mediaAsset: true },
    });

    res.json({ left: updated, right: newClip });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ---- Export / Render ----
app.post("/api/projects/:id/export", async (req, res) => {
  try {
    const prisma = getPrisma();
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: {
        tracks: {
          orderBy: { order: "asc" },
          include: { clips: { include: { mediaAsset: true } } },
        },
      },
    });
    if (!project) return res.status(404).json({ error: "proje bulunamadi" });

    const { quality = "medium" } = req.body;

    // Collect all clips from non-muted tracks
    const clips = [];
    for (const track of project.tracks) {
      if (track.muted) continue;
      for (const clip of track.clips) {
        if (!clip.mediaAsset) continue;
        clips.push({
          filePath: clip.mediaAsset.filePath,
          mediaStartMs: clip.mediaStartMs,
          mediaEndMs: clip.mediaEndMs,
          timelineStartMs: clip.timelineStartMs,
          trackType: track.type,
          hasVideo: clip.mediaAsset.type === "VIDEO",
          hasAudio: !!clip.mediaAsset.sampleRate,
          volume: clip.volume * track.volume,
          volumeKeyframes: clip.volumeKeyframes,
        });
      }
    }

    // Calculate total timeline duration
    let totalDurationMs = 0;
    for (const c of clips) {
      const end = c.timelineStartMs + (c.mediaEndMs - c.mediaStartMs);
      if (end > totalDurationMs) totalDurationMs = end;
    }

    if (totalDurationMs <= 0) {
      return res.status(400).json({ error: "timeline bos — export edilecek icerik yok" });
    }

    const exportDir = path.join(DATA_DIR, "projects", project.id, "exports");
    fs.mkdirSync(exportDir, { recursive: true });

    // Clean up old exports (keep last 2)
    const oldFiles = fs.readdirSync(exportDir).filter((f) => f.startsWith("export_")).sort();
    while (oldFiles.length > 2) {
      const rm = oldFiles.shift();
      try { fs.unlinkSync(path.join(exportDir, rm)); } catch {}
    }

    const outputPath = path.join(exportDir, `export_${Date.now()}.mp4`);

    // Respond immediately — export runs in background
    res.json({ status: "started" });

    emitProgress(project.id, { stage: "EXPORT_START", percent: 0 });

    try {
      await exportTimeline({
        clips,
        width: project.width,
        height: project.height,
        fps: project.fps,
        durationMs: totalDurationMs,
        outputPath,
        quality,
        onProgress: (percent) => {
          emitProgress(project.id, { stage: "EXPORTING", percent });
        },
      });

      const stat = fs.statSync(outputPath);
      emitProgress(project.id, {
        stage: "EXPORT_DONE",
        percent: 100,
        fileSize: stat.size,
        downloadUrl: `/api/projects/${project.id}/export/download`,
      });

      console.log(`[export] Done: ${outputPath} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
    } catch (e) {
      console.error("[export] Error:", e.message);
      emitProgress(project.id, {
        stage: "EXPORT_ERROR",
        error: String(e.message || e),
      });
    }
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: String(e) });
  }
});

app.get("/api/projects/:id/export/download", async (req, res) => {
  try {
    const exportDir = path.join(DATA_DIR, "projects", req.params.id, "exports");
    if (!fs.existsSync(exportDir)) return res.status(404).json({ error: "export bulunamadi" });

    const files = fs.readdirSync(exportDir)
      .filter((f) => f.startsWith("export_") && f.endsWith(".mp4"))
      .sort()
      .reverse();

    if (files.length === 0) return res.status(404).json({ error: "export dosyasi yok" });

    const filePath = path.join(exportDir, files[0]);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "dosya bulunamadi" });

    const stat = fs.statSync(filePath);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Content-Disposition", `attachment; filename="export.mp4"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ---- SSE Progress ----
app.get("/api/projects/:id/progress", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send({ stage: "CONNECTED" });
  const unsub = onProgress(req.params.id, send);
  req.on("close", unsub);
});

// ---- Static frontend ----
const distDir = path.join(ROOT, "dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("*", (_req, res) => res.sendFile(path.join(distDir, "index.html")));
}

function migrate() {
  if (!process.env.DATABASE_URL) {
    console.warn("[ve] DATABASE_URL yok — migrate atlandi.");
    return;
  }
  try {
    execFileSync("npx", ["prisma", "db", "push", "--skip-generate"], { cwd: ROOT, stdio: "inherit" });
  } catch (e) {
    console.error("[ve] prisma db push basarisiz:", String(e));
  }
}

migrate();
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[ve] http://0.0.0.0:${PORT}`);
  console.log(`[ve] Dubbing API: ${DUBBING_API}`);
});
