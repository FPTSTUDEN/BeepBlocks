export interface CanvasEditorProps {
  program: unknown;
  dispatch?: (...args: unknown[]) => void;
  ariaLabel?: string;
}

export function CanvasEditor({ ariaLabel = 'Flow canvas' }: CanvasEditorProps) {
  return (
    <div
      role="application"
      aria-label={ariaLabel}
      data-testid="bp-canvas-editor"
      style={{
        width: '100%',
        height: '100%',
        minHeight: '18rem',
        border: '1px solid var(--bp-border)',
        borderRadius: '8px',
        background: '#f3f4f6',
        display: 'grid',
        placeItems: 'center',
        color: 'var(--bp-muted)',
      }}
    >
      Canvas preview
    </div>
  );
}
