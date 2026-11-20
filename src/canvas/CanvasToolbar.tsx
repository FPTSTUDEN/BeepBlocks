interface CanvasToolbarProps {
  onReLayout: () => void;
  onFit: () => void;
  onZoomReset: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  showMinimap: boolean;
  showDataFlow: boolean;
  onToggleMinimap: () => void;
  onToggleDataFlow: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function CanvasToolbar({
  onReLayout,
  onFit,
  onZoomReset,
  onZoomIn,
  onZoomOut,
  showMinimap,
  showDataFlow,
  onToggleMinimap,
  onToggleDataFlow,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: CanvasToolbarProps) {
  return (
    <div role="toolbar" aria-label="Canvas tools" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
      <button type="button" className="btn" onClick={onUndo} disabled={!canUndo}>Undo</button>
      <button type="button" className="btn" onClick={onRedo} disabled={!canRedo}>Redo</button>
      <button type="button" className="btn" onClick={onReLayout}>Re-layout</button>
      <button type="button" className="btn" onClick={onFit}>Fit</button>
      <button type="button" className="btn" onClick={onZoomReset}>100%</button>
      <button type="button" className="btn" aria-label="Zoom out" onClick={onZoomOut}>−</button>
      <button type="button" className="btn" aria-label="Zoom in" onClick={onZoomIn}>+</button>
      <button type="button" className="btn" aria-pressed={showMinimap} onClick={onToggleMinimap}>
        {showMinimap ? 'Hide minimap' : 'Minimap'}
      </button>
      <button type="button" className="btn" aria-pressed={showDataFlow} onClick={onToggleDataFlow}>
        ~ Data flow
      </button>
    </div>
  );
}
