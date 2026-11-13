export type EditorMode = 'blocks' | 'canvas';

export function getEditorModeKey(fileId: string): string {
  return `beep-canvas-mode-${encodeURIComponent(fileId || 'untitled')}`;
}

export function loadEditorMode(fileId: string): EditorMode {
  if (typeof window === 'undefined') return 'blocks';
  const key = getEditorModeKey(fileId);
  const raw = window.localStorage.getItem(key);
  return raw === 'canvas' ? 'canvas' : 'blocks';
}

export function saveEditorMode(fileId: string, mode: EditorMode): void {
  if (typeof window === 'undefined') return;
  const key = getEditorModeKey(fileId);
  if (mode === 'canvas') {
    window.localStorage.setItem(key, 'canvas');
  } else {
    window.localStorage.removeItem(key);
  }
}

export interface ModeToggleProps {
  mode: EditorMode;
  onChange: (mode: EditorMode) => void;
}

export function ModeToggle({ mode, onChange }: ModeToggleProps) {
  const options: Array<{ value: EditorMode; label: string }> = [
    { value: 'blocks', label: 'Blocks' },
    { value: 'canvas', label: 'Canvas' },
  ];

  return (
    <div className="bp-mode-toggle" role="group" aria-label="Editor mode">
      {options.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          className="btn"
          aria-label={label}
          aria-pressed={mode === value}
          onClick={() => onChange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
