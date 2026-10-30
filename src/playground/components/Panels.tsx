/** Variables, Counters and Output panels (task E.4). */
import { useId } from 'react';
import type { Counters, OutputLine } from '../../ir/timeline.ts';
import { formatValue, valueType } from '../lib/format.ts';
import type { IndexStatus, VisibleVar } from '../lib/tags.ts';
import styles from '../Playground.module.css';

export interface VariablesPanelProps {
  vars: readonly VisibleVar[];
  missing: ReadonlySet<string>;
  indexStatus: ReadonlyMap<string, IndexStatus>;
  /** Name of the list the index variables point into, if shown. */
  listName: string | null;
}

export function VariablesPanel({ vars, missing, indexStatus, listName }: VariablesPanelProps) {
  const headingId = useId();
  return (
    <section className={styles.surface} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.heading}>
        Variables
      </h3>
      {vars.length === 0 ? (
        <p className={styles.empty}>No variables yet.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Type</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            {vars.map((v) => {
              const status = indexStatus.get(v.name);
              return (
                <tr key={`${v.scope ?? ''}:${v.name}`} data-var={v.name}>
                  <th scope="row" className={styles.mono}>
                    {v.name}
                    {v.scope !== null && <span className={styles.hint}> (in {v.scope})</span>}
                  </th>
                  <td>{valueType(v.value)}</td>
                  <td className={styles.mono}>
                    {formatValue(v.value)}
                    {missing.has(v.name) && <span className={styles.missing}> (missing)</span>}
                    {status && status !== 'in range' && listName && (
                      <span className={styles.hint}>
                        {status === 'end' ? ` (end of ${listName})` : ` (outside ${listName})`}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function CountersPanel({
  counters,
  listSize,
}: {
  counters: Counters;
  listSize: number | null;
}) {
  const headingId = useId();
  const items: [string, number][] = [
    ['Steps', counters.steps],
    ['Reads', counters.reads],
    ['File changes', counters.fileOps],
    ['Comparisons', counters.comparisons],
  ];
  if (listSize !== null) items.push(['List size', listSize]);
  return (
    <section className={styles.surface} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.heading}>
        Counters
      </h3>
      <dl className={styles.counters}>
        {items.map(([label, value]) => (
          <div key={label} style={{ display: 'contents' }}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const LINE_KIND = {
  print: { icon: '›', label: 'print' },
  action: { icon: '⚙', label: 'action' },
} as const;

export function OutputPanel({ lines }: { lines: readonly OutputLine[] }) {
  const headingId = useId();
  return (
    <section className={styles.surface} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.heading}>
        Output
      </h3>
      {lines.length === 0 ? (
        <p className={styles.empty}>No output yet.</p>
      ) : (
        <ol className={styles.output}>
          {lines.map((l, i) => (
            <li key={i} className={styles.outputLine} data-kind={l.kind}>
              <span className={styles.lineKind}>
                <span aria-hidden="true">{LINE_KIND[l.kind].icon}</span> {LINE_KIND[l.kind].label}
              </span>
              <span>{l.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
