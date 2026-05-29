import type { AuthUser, Project, MediaAsset, Track, Clip } from "./types";

const base = "/api";

async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(base + url, opts);
  if (!r.ok) {
    const body = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error(body.error || r.statusText);
  }
  return r.json();
}

export const api = {
  // Auth
  authMe: () => req<AuthUser>("/auth/me"),

  // Projects
  listProjects: () => req<Project[]>("/projects"),
  getProject: (id: string) => req<Project>(`/projects/${id}`),
  createProject: (data?: Partial<Project>) =>
    req<Project>("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data || {}),
    }),
  updateProject: (id: string, data: Partial<Project>) =>
    req<Project>(`/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  deleteProject: (id: string) =>
    req<{ ok: boolean }>(`/projects/${id}`, { method: "DELETE" }),

  // Media
  uploadMedia: (projectId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch(`${base}/projects/${projectId}/media`, {
      method: "POST",
      body: form,
    }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
      return r.json() as Promise<MediaAsset>;
    });
  },
  listMedia: (projectId: string) => req<MediaAsset[]>(`/projects/${projectId}/media`),
  deleteMedia: (projectId: string, mediaId: string) =>
    req<{ ok: boolean }>(`/projects/${projectId}/media/${mediaId}`, { method: "DELETE" }),

  // Media URLs
  streamUrl: (assetId: string) => `/media/${assetId}/stream`,
  thumbnailUrl: (assetId: string) => `/media/${assetId}/thumbnail`,
  waveformUrl: (assetId: string) => `/media/${assetId}/waveform`,

  // Tracks
  addTrack: (projectId: string, data: { name?: string; type?: string }) =>
    req<Track>(`/projects/${projectId}/tracks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  updateTrack: (trackId: string, data: Partial<Track>) =>
    req<Track>(`/tracks/${trackId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  deleteTrack: (trackId: string) =>
    req<{ ok: boolean }>(`/tracks/${trackId}`, { method: "DELETE" }),

  // Clips
  addClip: (trackId: string, data: Partial<Clip> & { mediaAssetId: string; mediaEndMs: number }) =>
    req<Clip>(`/tracks/${trackId}/clips`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  updateClip: (clipId: string, data: Partial<Clip>) =>
    req<Clip>(`/clips/${clipId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  deleteClip: (clipId: string) =>
    req<{ ok: boolean }>(`/clips/${clipId}`, { method: "DELETE" }),
  splitClip: (clipId: string, timeMs: number) =>
    req<{ left: Clip; right: Clip }>(`/clips/${clipId}/split`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timeMs }),
    }),
};
