export const CANVAS_STMT_MIME = 'application/x-beepblocks-statement';

export function CanvasPalette({ disabled = false }: { disabled?: boolean }) {
  return (
    <div
      aria-label="Statement palette"
      role="toolbar"
      style={{ display: 'flex', gap: '0.5rem', padding: '0.5rem', background: 'var(--bp-surface, white)' }}
    >
      <button
        type="button"
        className="btn"
        draggable={!disabled}
        disabled={disabled}
        data-statement="move-file"
        onDragStart={(event) => {
          event.dataTransfer.setData(CANVAS_STMT_MIME, 'move-file');
          event.dataTransfer.effectAllowed = 'copy';
        }}
      >
        Move file
      </button>
    </div>
  );
}
