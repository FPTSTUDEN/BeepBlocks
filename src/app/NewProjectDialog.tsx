/**
 * "New project" dialog (tasks 3.2): open a starter project for any scenario in one click, or
 * start a blank project on the current scenario. Opening the dialog is the confirmation that
 * the current project will be replaced, so no extra prompt follows.
 */
import { useId } from 'react';
import type { Scenario } from '../domains/fileExplorer/fsTypes.ts';
import { SCENARIOS } from '../domains/fileExplorer/scenarios/index.ts';
import { schemaFor } from '../ir/composites.ts';
import { Dialog } from './Dialog.tsx';
import { newProject, type ProjectFile } from './project.ts';
import { STARTERS, starterProject } from './starters.ts';

export interface NewProjectDialogProps {
  /** Scenario for a blank project (the current one). */
  blankScenario: Scenario;
  onOpen: (project: ProjectFile) => void;
  onClose: () => void;
}

export function NewProjectDialog({ blankScenario, onOpen, onClose }: NewProjectDialogProps) {
  const listId = useId();
  return (
    <Dialog title="New project" onClose={onClose}>
      <p>
        Start from an example, or with an empty program. This replaces the current project; use
        “Save file” first to keep a copy.
      </p>
      <h3 id={listId} className="new-heading">
        Examples
      </h3>
      <ul className="starters" aria-labelledby={listId}>
        {STARTERS.map((s) => {
          const scenario = SCENARIOS.find((x) => x.id === s.scenarioId);
          const composite = s.program.body.find((n) => n.kind === 'composite');
          return (
            <li key={s.scenarioId} className="starter">
              <div>
                <strong>{s.title}</strong>
                <span className="hint">
                  {' '}
                  — {scenario?.title}
                  {composite?.kind === 'composite' && `, “${schemaFor(composite.name).label}”`}
                </span>
                <p>{s.summary}</p>
              </div>
              <button
                type="button"
                className="btn primary"
                aria-label={`Open example “${s.title}”`}
                onClick={() => onOpen(starterProject(s))}
              >
                Open
              </button>
            </li>
          );
        })}
      </ul>
      <div className="actions">
        <button type="button" className="btn" onClick={() => onOpen(newProject(blankScenario))}>
          Blank project ({blankScenario.title})
        </button>
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
