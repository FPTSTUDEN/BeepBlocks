/** Visual theme settings (Task 2.5): light/dark preset and accent colour. */
import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { DEFAULT_ACCENT, legibleAccent, type Mode, type Settings } from './settings.ts';

export function SettingsMenu({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}) {
  const accentId = useId();
  const noteId = useId();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const accentRef = useRef<HTMLInputElement>(null);
  const applied = legibleAccent(settings.accent, settings.mode);
  const adjusted = applied.toLowerCase() !== settings.accent.toLowerCase();

  // Close when focus or a click lands outside the open panel (it is a popover, not a dialog).
  useEffect(() => {
    const onPointer = (e: Event) => {
      const el = detailsRef.current;
      if (el?.open && !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('focusin', onPointer);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('focusin', onPointer);
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    const el = detailsRef.current;
    if (e.key === 'Escape' && el?.open) {
      e.preventDefault();
      e.stopPropagation();
      el.open = false;
      summaryRef.current?.focus();
    }
  };

  return (
    <details className="settings" ref={detailsRef} onKeyDown={onKeyDown}>
      <summary className="btn" ref={summaryRef}>
        Settings
      </summary>
      <div className="settings-panel">
        <fieldset>
          <legend>Theme</legend>
          {(['light', 'dark'] as Mode[]).map((m) => (
            <label key={m} className="row">
              <input
                type="radio"
                name="bp-mode"
                value={m}
                checked={settings.mode === m}
                onChange={() => onChange({ mode: m })}
              />
              {m === 'light' ? 'Light' : 'Dark'}
            </label>
          ))}
        </fieldset>
        <label className="row">
          <input
            type="checkbox"
            checked={settings.showAdvanced}
            onChange={(e) => onChange({ showAdvanced: e.target.checked })}
          />
          Show advanced blocks
        </label>
        <div className="row">
          <label htmlFor={accentId}>Accent colour</label>
          <input
            ref={accentRef}
            id={accentId}
            type="color"
            value={settings.accent}
            aria-describedby={adjusted ? noteId : undefined}
            onChange={(e) => onChange({ accent: e.target.value })}
          />
          <button
            type="button"
            className="btn"
            disabled={settings.accent === DEFAULT_ACCENT}
            onClick={() => {
              onChange({ accent: DEFAULT_ACCENT });
              // The button is about to become disabled; keep focus in the panel.
              accentRef.current?.focus();
            }}
          >
            Reset
          </button>
        </div>
        {adjusted && (
          <p id={noteId} className="hint">
            Shown as <span className="swatch" style={{ background: applied }} /> {applied} so
            text stays readable.
          </p>
        )}
      </div>
    </details>
  );
}
