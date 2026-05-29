import { useEffect, useRef } from "react";

export interface MenuItem {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: ContextMenuState & { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handle);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handle);
    };
  }, [onClose]);

  // Keep menu within viewport
  const menuW = 200;
  const menuH = items.length * 32 + 8;
  const adjustedX = x + menuW > window.innerWidth ? x - menuW : x;
  const adjustedY = y + menuH > window.innerHeight ? y - menuH : y;

  return (
    <div
      ref={ref}
      className="fixed bg-gray-900 border border-gray-700 rounded-lg shadow-2xl py-1 min-w-[180px] z-50"
      style={{ left: adjustedX, top: adjustedY }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between transition-colors ${
            item.disabled
              ? "text-gray-600 cursor-default"
              : item.danger
                ? "text-red-400 hover:bg-red-900/30 cursor-pointer"
                : "text-gray-300 hover:bg-gray-800 cursor-pointer"
          }`}
          onClick={() => {
            if (!item.disabled) {
              item.onClick();
              onClose();
            }
          }}
          disabled={item.disabled}
        >
          <span>{item.label}</span>
          {item.shortcut && (
            <span className="text-gray-600 text-[10px] ml-4">{item.shortcut}</span>
          )}
        </button>
      ))}
    </div>
  );
}
