import { useCallback, useEffect, useRef, useState } from 'react';
import './SplitPane.css';

interface SplitPaneProps {
  left: React.ReactNode;
  right: React.ReactNode;
  storageKey?: string;
}

export default function SplitPane({ left, right, storageKey }: SplitPaneProps) {
  const [leftPercent, setLeftPercent] = useState(() => {
    if (storageKey) {
      const saved = localStorage.getItem(storageKey);
      if (saved) return Number(saved);
    }
    return 50;
  });
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.min(Math.max(pct, 10), 90);
      setLeftPercent(clamped);
      if (storageKey) localStorage.setItem(storageKey, String(clamped));
    };
    const onMouseUp = () => {
      dragging.current = false;
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [storageKey]);

  return (
    <div className="split-pane" ref={containerRef}>
      <div
        className="split-left"
        style={{ width: `calc(${leftPercent}% - 2.5px)` }}
      >
        {left}
      </div>
      <div
        className="split-divider"
        onMouseDown={onMouseDown}
        onDoubleClick={() => {
          setLeftPercent(50);
          if (storageKey) localStorage.setItem(storageKey, '50');
        }}
      />
      <div className="split-right" style={{ flex: 1 }}>
        {right}
      </div>
    </div>
  );
}
