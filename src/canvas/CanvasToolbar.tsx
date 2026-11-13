interface CanvasToolbarProps {
  onReLayout?: () => void;
  onFit?: () => void;
  onZoomReset?: () => void;
  showMinimap?: boolean;
  showDataFlow?: boolean;
  onToggleMinimap?: () => void;
  onToggleDataFlow?: () => void;
}

export function CanvasToolbar({
  onReLayout,
  onFit,
  onZoomReset,
  showMinimap,
  showDataFlow,
  onToggleMinimap,
  onToggleDataFlow,
}: CanvasToolbarProps) {
  return (
    <div role="toolbar" aria-label="Canvas tools" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
      <button type="button" className="btn" onClick={onReLayout}>Re-layout</button>
      <button type="button" className="btn" onClick={onFit}>Fit</button>
      <button type="button" className="btn" onClick={onZoomReset}>100%</button>
      <button type="button" className="btn" aria-pressed={showMinimap} onClick={onToggleMinimap}>
        {showMinimap ? 'Hide minimap' : 'Minimap'}
      </button>
      <button type="button" className="btn" aria-pressed={showDataFlow} onClick={onToggleDataFlow}>
        {showDataFlow ? 'Hide data flow' : 'Show data flow'}
      </button>
    </div>
  );
}
