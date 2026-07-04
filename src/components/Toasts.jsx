// src/components/Toasts.jsx
import useEditorStore from '../store/editorStore';

const COLORS = { info: '#21262d', success: '#1a3a1a', error: '#3a1a1a', warn: '#3a2e10' };

export default function Toasts() {
  const toasts = useEditorStore(s => s.toasts);
  return (
    <div className="fixed bottom-8 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          style={{ background: COLORS[t.type] || COLORS.info }}
          className="px-4 py-2 rounded-lg border border-[#30363d] text-[#e6edf3] text-sm shadow-lg max-w-xs"
        >
          {t.msg}
        </div>
      ))}
    </div>
  );
}
