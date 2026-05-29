import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "./api";
import type { AuthUser, Project } from "./types";
import { useTimeline } from "./stores/timeline";
import { usePlayback } from "./hooks/usePlayback";
import { useKeyboard } from "./hooks/useKeyboard";
import { Toolbar } from "./components/layout/Toolbar";
import { MediaBin } from "./components/media/MediaBin";
import { VideoPreview } from "./components/preview/VideoPreview";
import { TimelineCanvas } from "./components/timeline/TimelineCanvas";
import { TrackHeaders } from "./components/timeline/TrackHeaders";
import { ExportModal } from "./components/export/ExportModal";

// ---- Login Screen ----
function LoginScreen() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-2">VideoEdit Studio</h1>
        <p className="text-gray-500 mb-6">Devam etmek icin giris yapin</p>
        <a
          href="/auth/google"
          className="inline-flex items-center gap-3 px-6 py-3 bg-white text-gray-900 rounded-lg font-medium hover:bg-gray-100 transition-colors"
        >
          Google ile giris yap
        </a>
      </div>
    </div>
  );
}

// ---- Project List ----
function ProjectList({ onSelect }: { onSelect: (id: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(() => {
    api.listProjects().then(setProjects).catch(() => {});
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function createProject() {
    setCreating(true);
    try {
      const p = await api.createProject({ title: "Yeni Proje" });
      onSelect(p.id);
    } catch {}
    setCreating(false);
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">VideoEdit Studio</h1>
        <button
          onClick={createProject}
          disabled={creating}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {creating ? "..." : "+ Yeni Proje"}
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg mb-2">Henuz proje yok</p>
          <p className="text-sm">Yeni bir proje olusturun</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {projects.map((p) => (
            <div
              key={p.id}
              onClick={() => onSelect(p.id)}
              className="flex items-center justify-between p-4 bg-gray-900 rounded-lg hover:bg-gray-800 cursor-pointer transition-colors"
            >
              <div>
                <h3 className="font-medium">{p.title}</h3>
                <p className="text-xs text-gray-500 mt-1">
                  {p.width}x{p.height} / {p.fps}fps
                  {p._count && ` / ${p._count.media} medya, ${p._count.tracks} track`}
                </p>
              </div>
              <span className="text-xs text-gray-600">
                {new Date(p.updatedAt).toLocaleDateString("tr")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Editor View ----
function EditorView({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const project = useTimeline((s) => s.project);
  const setProject = useTimeline((s) => s.setProject);
  const [showExport, setShowExport] = useState(false);

  // Resizable timeline panel
  const [timelineHeight, setTimelineHeight] = useState(280);
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  const MIN_TIMELINE = 120;
  const MAX_TIMELINE = 600;

  const handleDividerDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startY.current = e.clientY;
    startHeight.current = timelineHeight;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, [timelineHeight]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!isDragging.current) return;
      const delta = startY.current - e.clientY;
      const next = Math.min(MAX_TIMELINE, Math.max(MIN_TIMELINE, startHeight.current + delta));
      setTimelineHeight(next);
    }
    function onUp() {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  usePlayback();
  useKeyboard();

  const loadProject = useCallback(() => {
    api.getProject(projectId).then(setProject).catch(() => {});
  }, [projectId, setProject]);

  useEffect(() => { loadProject(); }, [loadProject]);

  if (!project) {
    return <div className="flex items-center justify-center h-screen text-gray-500">Yukleniyor...</div>;
  }

  return (
    <div className="flex flex-col h-screen">
      <Toolbar projectTitle={project.title} onBack={onBack} onExport={() => setShowExport(true)} />

      {/* Main area: media bin + preview + inspector */}
      <div className="flex flex-1 min-h-0">
        {/* Left panel: Media Bin */}
        <div className="w-56 border-r border-gray-800 flex-shrink-0">
          <MediaBin
            projectId={project.id}
            media={project.media}
            onMediaChange={loadProject}
          />
        </div>

        {/* Center: Video Preview */}
        <div className="flex-1 relative">
          <VideoPreview />
        </div>
      </div>

      {/* Draggable divider */}
      <div
        onMouseDown={handleDividerDown}
        className="h-1.5 bg-gray-800 hover:bg-blue-500 active:bg-blue-400 cursor-row-resize flex-shrink-0 transition-colors relative group"
      >
        <div className="absolute inset-x-0 -top-1 -bottom-1" />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-0.5 bg-gray-600 group-hover:bg-blue-300 rounded-full" />
      </div>

      {/* Bottom: Timeline */}
      <div style={{ height: timelineHeight }} className="border-t border-gray-800 flex-shrink-0 flex">
        <TrackHeaders projectId={project.id} />
        <TimelineCanvas />
      </div>

      {/* Export Modal */}
      {showExport && (
        <ExportModal projectId={project.id} onClose={() => setShowExport(false)} />
      )}
    </div>
  );
}

// ---- App Root ----
export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);

  useEffect(() => {
    api.authMe()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setAuthChecked(true));
  }, []);

  if (!authChecked) {
    return <div className="flex items-center justify-center h-screen text-gray-500 text-sm">Yukleniyor...</div>;
  }

  if (!user) return <LoginScreen />;

  if (!projectId) return <ProjectList onSelect={setProjectId} />;

  return <EditorView projectId={projectId} onBack={() => setProjectId(null)} />;
}
