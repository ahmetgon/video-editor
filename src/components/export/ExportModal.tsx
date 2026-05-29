import { useState, useEffect, useRef } from "react";
import { api } from "../../api";
import { useTimeline } from "../../stores/timeline";

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ExportModal({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const [quality, setQuality] = useState("medium");
  const [status, setStatus] = useState<"idle" | "exporting" | "done" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const esRef = useRef<EventSource | null>(null);
  const project = useTimeline((s) => s.project);
  const durationMs = useTimeline((s) => s.durationMs);

  // SSE connection for progress
  useEffect(() => {
    const es = new EventSource(`/api/projects/${projectId}/progress`);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        switch (data.stage) {
          case "EXPORT_START":
            setStatus("exporting");
            setProgress(0);
            break;
          case "EXPORTING":
            setProgress(data.percent || 0);
            break;
          case "EXPORT_DONE":
            setStatus("done");
            setProgress(100);
            if (data.fileSize) setFileSize(data.fileSize);
            break;
          case "EXPORT_ERROR":
            setStatus("error");
            setErrorMsg(data.error || "Export hatasi");
            break;
        }
      } catch {}
    };

    return () => es.close();
  }, [projectId]);

  async function startExport() {
    setStatus("exporting");
    setProgress(0);
    setErrorMsg("");
    try {
      await api.exportProject(projectId, { quality });
    } catch (e: any) {
      setStatus("error");
      setErrorMsg(e.message || "Export baslatilamadi");
    }
  }

  function download() {
    window.open(`/api/projects/${projectId}/export/download`, "_blank");
  }

  function formatDuration(ms: number) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={(e) => e.target === e.currentTarget && status !== "exporting" && onClose()}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-[420px] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
          <h2 className="text-sm font-semibold">Export / Render</h2>
          <button
            onClick={onClose}
            disabled={status === "exporting"}
            className="text-gray-500 hover:text-white text-lg disabled:opacity-30"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Project info */}
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>
              {project?.width}×{project?.height} / {project?.fps}fps
            </span>
            <span>Sure: {formatDuration(durationMs)}</span>
          </div>

          {/* Quality */}
          <div>
            <label className="text-xs text-gray-400 block mb-1.5">Kalite</label>
            <div className="flex gap-2">
              {[
                { value: "low", label: "Dusuk", desc: "Hizli render, buyuk CRF" },
                { value: "medium", label: "Orta", desc: "Dengeli kalite" },
                { value: "high", label: "Yuksek", desc: "En iyi kalite" },
              ].map((q) => (
                <button
                  key={q.value}
                  onClick={() => setQuality(q.value)}
                  disabled={status === "exporting"}
                  className={`flex-1 px-2 py-2 text-xs rounded-lg transition-colors ${
                    quality === q.value
                      ? "bg-blue-600 text-white ring-1 ring-blue-400"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  } disabled:opacity-50`}
                >
                  <div className="font-medium">{q.label}</div>
                  <div className="text-[10px] opacity-60 mt-0.5">{q.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Format info */}
          <div className="text-xs text-gray-600 bg-gray-800/50 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <span>Format</span>
              <span className="text-gray-400">MP4 (H.264 + AAC)</span>
            </div>
          </div>

          {/* Progress */}
          {status === "exporting" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">
                  {progress < 5 ? "Hazirlaniyor..." : "Render ediliyor..."}
                </span>
                <span className="text-blue-400 font-mono">{progress}%</span>
              </div>
              <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Done */}
          {status === "done" && (
            <div className="text-center py-3 space-y-3">
              <div className="text-green-400 text-sm font-medium">
                Export tamamlandi!
              </div>
              {fileSize > 0 && (
                <div className="text-xs text-gray-500">
                  Dosya boyutu: {formatSize(fileSize)}
                </div>
              )}
              <button
                onClick={download}
                className="px-5 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-medium transition-colors"
              >
                Indir (.mp4)
              </button>
            </div>
          )}

          {/* Error */}
          {status === "error" && (
            <div className="bg-red-900/20 border border-red-800/30 rounded-lg p-3">
              <div className="text-red-400 text-xs font-medium mb-1">
                Export hatasi
              </div>
              <div className="text-red-300/70 text-[11px] break-all">
                {errorMsg}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-800">
          <button
            onClick={onClose}
            disabled={status === "exporting"}
            className="px-4 py-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg disabled:opacity-30 transition-colors"
          >
            Kapat
          </button>
          {status !== "done" && (
            <button
              onClick={startExport}
              disabled={status === "exporting" || durationMs <= 0}
              className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 rounded-lg font-medium disabled:opacity-50 transition-colors"
            >
              {status === "exporting"
                ? "Render ediliyor..."
                : status === "error"
                  ? "Tekrar dene"
                  : "Export et"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
