/** Visual theme settings (Task 2.5): light/dark preset and accent colour. */
import { useId } from 'react';
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
  const applied = legibleAccent(settings.accent, settings.mode);
  const adjusted = applied.toLowerCase() !== settings.accent.toLowerCase();

  return (
    <details className="settings">
      <summary className="btn">Settings</summary>
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
        <div className="row">
          <label htmlFor={accentId}>Accent colour</label>
          <input
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
            onClick={() => onChange({ accent: DEFAULT_ACCENT })}
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
