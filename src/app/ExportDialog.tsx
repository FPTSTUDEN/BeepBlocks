/** Export dialog (Task 2.3, Req 9.7–9.8): script preview, download, copy, or the error list. */
import { useMemo, useState } from 'react';
import type { NodeId, Program } from '../ir/types.ts';
import type { DesugarProgram } from '../ir/composites.ts';
import { exportPython } from '../export/index.ts';
import { Dialog } from './Dialog.tsx';
import { IssueList } from './IssueList.tsx';
import { downloadText } from './download.ts';

export interface ExportDialogProps {
  program: Program;
  title: string;
  desugar: DesugarProgram;
  onClose: () => void;
  onShowBlock: (id: NodeId) => void;
}

/** `my_project.py` from the project title. */
export function scriptFileName(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return (base || 'program') + '.py';
}

export function ExportDialog({ program, title, desugar, onClose, onShowBlock }: ExportDialogProps) {
  const result = useMemo(() => exportPython(program, { desugar, title }), [program, desugar, title]);
  const [copyStatus, setCopyStatus] = useState('');
  const fileName = scriptFileName(title);

  if (!result.ok) {
    const errors = result.errors.filter((e) => e.severity === 'error');
    return (
      <Dialog title="Export to Python" onClose={onClose}>
        <p>
          The program can’t be exported yet. Fix{' '}
          {errors.length === 1 ? 'this problem' : `these ${errors.length} problems`} first:
        </p>
        <IssueList
          issues={errors}
          onShowBlock={(id) => {
            onShowBlock(id);
            onClose();
          }}
        />
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </Dialog>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.source);
      setCopyStatus('Copied to the clipboard.');
    } catch {
      setCopyStatus('Could not copy; select the text and copy it instead.');
    }
  };

  return (
    <Dialog title="Export to Python" onClose={onClose}>
      <p>
        This script does the same steps on a real folder. Run{' '}
        <code>python {fileName} FOLDER</code> to preview what it would change, then add{' '}
        <code>--apply</code> to make the changes. It needs Python 3.9 or newer.
      </p>
      <pre className="code" tabIndex={0} aria-label="Python script">
        {result.source}
      </pre>
      <div className="actions">
        <button
          type="button"
          className="btn primary"
          onClick={() => downloadText(fileName, result.source, 'text/x-python')}
        >
          Download {fileName}
        </button>
        <button type="button" className="btn" onClick={() => void copy()}>
          Copy
        </button>
        <span role="status" className="hint">
          {copyStatus}
        </span>
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
