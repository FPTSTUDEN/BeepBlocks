/**
 * App shell (Tasks 2.2–2.5, design.md §3, §10, §13). The only module that wires the editor,
 * playground, simulator, composites and exporter together.
 */
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { useStore } from 'zustand';
import type { NodeId } from '../ir/types.ts';
import { BlockEditor } from '../editor/index.tsx';
import { Playground } from '../playground/index.tsx';
import { SCENARIOS } from '../domains/fileExplorer/scenarios/index.ts';
import { deepEqual } from './deepEqual.ts';
import { Dialog } from './Dialog.tsx';
import { ExportDialog } from './ExportDialog.tsx';
import { IssueList } from './IssueList.tsx';
import { downloadText, readFileText } from './download.ts';
import {
  PROJECT_EXTENSION,
  newProject,
  parseProject,
  projectFileName,
  serializeProject,
} from './project.ts';
import { applyTheme } from './settings.ts';
import { SettingsMenu } from './SettingsMenu.tsx';
import { activeNodeIds, isStale, type AppState, type AppStore } from './store.ts';
import './app.css';

const StoreContext = createContext<AppStore | null>(null);

function useApp<T>(selector: (s: AppState) => T): T {
  const store = useContext(StoreContext);
  if (!store) throw new Error('App store missing');
  return useStore(store, selector);
}

export function App({ store }: { store: AppStore }) {
  return (
    <StoreContext.Provider value={store}>
      <Shell store={store} />
    </StoreContext.Provider>
  );
}

function Shell({ store }: { store: AppStore }) {
  const project = useApp((s) => s.project);
  const issues = useApp((s) => s.issues);
  const timeline = useApp((s) => s.timeline);
  const index = useApp((s) => s.index);
  const running = useApp((s) => s.running);
  const runProblem = useApp((s) => s.runProblem);
  const editingScenario = useApp((s) => s.editingScenario);
  const marked = useApp((s) => s.marked);
  const settings = useApp((s) => s.settings);
  const saveFailed = useApp((s) => s.saveFailed);
  const stale = useApp(isStale);
  const actions = store.getState();

  const [exportOpen, setExportOpen] = useState(false);
  const [importErrors, setImportErrors] = useState<string[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const runHintId = useId();

  // Theme variables must be in place before the editor's effects read them.
  useLayoutEffect(() => applyTheme(settings), [settings]);

  useEffect(() => {
    document.title = `${project.title || 'Untitled'} — Block Playground`;
  }, [project.title]);

  useEffect(() => {
    const flush = () => store.flush();
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, [store]);

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const blocked = errorCount > 0;
  const highlight = timeline && !stale ? activeNodeIds({ timeline, index }) : [];
  const showBlock = (id: NodeId) => actions.mark([id]);

  const builtin = SCENARIOS.find((s) => s.id === project.scenario.id);
  const scenarioEdited = !builtin || !deepEqual(builtin.tree, project.scenario.tree);

  const pickScenario = (e: ChangeEvent<HTMLSelectElement>) => {
    const next = SCENARIOS.find((s) => s.id === e.target.value);
    if (!next) return;
    if (scenarioEdited && !window.confirm('Switch scenario? Your changes to the current files will be lost.')) {
      e.target.value = project.scenario.id;
      return;
    }
    actions.pickScenario(next);
  };

  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    let text: string;
    try {
      text = await readFileText(file);
    } catch {
      setImportErrors(['The file could not be read.']);
      return;
    }
    const res = parseProject(text);
    if (!res.ok) {
      setImportErrors(res.errors);
      return;
    }
    if (window.confirm(`Open "${res.project.title}"? This replaces the current project.`)) {
      actions.replaceProject(res.project);
    }
  };

  const onNew = () => {
    if (window.confirm('Start a new project? This replaces the current project.')) {
      actions.replaceProject(newProject(builtin ?? SCENARIOS[0]));
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>Block Playground</h1>
        <input
          type="text"
          className="title-input"
          aria-label="Project title"
          value={project.title}
          maxLength={100}
          onChange={(e) => actions.setTitle(e.target.value)}
        />
        <div className="group">
          <label htmlFor="bp-scenario">Scenario</label>
          <select id="bp-scenario" value={builtin ? project.scenario.id : ''} onChange={pickScenario}>
            {!builtin && <option value="">{project.scenario.title} (imported)</option>}
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
          {scenarioEdited && builtin && <span className="hint">(edited)</span>}
          <button
            type="button"
            className="btn"
            aria-pressed={editingScenario}
            onClick={() => actions.setEditingScenario(!editingScenario)}
          >
            {editingScenario ? 'Done editing' : 'Edit scenario'}
          </button>
        </div>
        <div className="group">
          <span id={runHintId} className="hint" role="status">
            {blocked
              ? `${errorCount} problem${errorCount === 1 ? '' : 's'} to fix before running`
              : running
                ? 'Running…'
                : ''}
          </span>
          <button
            type="button"
            className="btn"
            disabled={blocked}
            aria-describedby={runHintId}
            onClick={() => setExportOpen(true)}
          >
            Export Python
          </button>
        </div>
        <span className="spacer" />
        <div className="group">
          <button type="button" className="btn" onClick={onNew}>
            New
          </button>
          <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
            Open…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={`${PROJECT_EXTENSION},.json,application/json`}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => void onImport(e)}
          />
          <button
            type="button"
            className="btn"
            onClick={() =>
              downloadText(projectFileName(project.title), serializeProject(project), 'application/json')
            }
          >
            Save file
          </button>
          <SettingsMenu settings={settings} onChange={actions.setSettings} />
        </div>
      </header>

      <div className="banners" aria-live="polite">
        {runProblem?.kind === 'invalid' && (
          <div className="banner danger" role="alert">
            <strong>Can’t run yet:</strong>
            <IssueList
              issues={runProblem.issues.filter((i) => i.severity === 'error')}
              onShowBlock={showBlock}
            />
            <button type="button" className="btn" onClick={actions.dismissRunProblem}>
              Dismiss
            </button>
          </div>
        )}
        {runProblem?.kind === 'crash' && (
          <div className="banner danger" role="alert">
            <strong>Error:</strong>
            <span>{runProblem.message}. The app is still usable; try running again.</span>
            <button type="button" className="btn" onClick={actions.dismissRunProblem}>
              Dismiss
            </button>
          </div>
        )}
        {saveFailed && (
          <div className="banner warning" role="status">
            <strong>Not saved:</strong>
            <span>
              The browser refused to store this project. Use “Save file” to keep a copy.
            </span>
          </div>
        )}
      </div>

      <main className="workspace">
        <div className="pane editor">
          <BlockEditor
            program={project.program}
            layout={project.layout}
            onChange={actions.editorChanged}
            desugarOne={store.deps.desugarOne}
            highlightIds={highlight}
            markedIds={marked}
            themeKey={`${settings.mode}:${settings.accent}`}
          />
        </div>
        <div className="pane">
          <Playground
            initial={project.scenario.tree}
            timeline={timeline}
            index={index}
            onIndexChange={actions.setIndex}
            stale={stale}
            onRun={() => void actions.run()}
            onReset={actions.reset}
            onTrace={actions.mark}
            editingScenario={editingScenario}
            onScenarioChange={actions.setScenarioTree}
            label={`Playground: ${project.scenario.title}`}
            runBlockedReason={
              blocked ? 'Fix the problems marked in the editor to run.' : running ? 'Running…' : null
            }
          />
        </div>
      </main>

      {exportOpen && (
        <ExportDialog
          program={project.program}
          title={project.title}
          desugar={store.deps.desugarProgram}
          onClose={() => setExportOpen(false)}
          onShowBlock={showBlock}
        />
      )}
      {importErrors && (
        <Dialog title="This project can’t be opened" onClose={() => setImportErrors(null)}>
          <p>Nothing was changed. The file has these problems:</p>
          <ul className="issues">
            {importErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
          <div className="actions">
            <span className="spacer" />
            <button type="button" className="btn" onClick={() => setImportErrors(null)}>
              Close
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
