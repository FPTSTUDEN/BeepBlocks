/** Diff badges and variable tags — always icon + text, never color alone (Req 13.5). */
import type { DiffEntry } from '../lib/diff.ts';
import { DIFF_LABELS } from '../lib/diff.ts';
import { baseName, displayPath } from '../lib/paths.ts';
import styles from '../Playground.module.css';

export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

/** Extra text explaining a diff state (old name, origin). */
export function diffDetail(d: DiffEntry): string | null {
  if (d.kind === 'renamed' && d.oldPath !== undefined) return `was ${baseName(d.oldPath)}`;
  if (d.kind === 'moved' && d.oldPath !== undefined) return `from ${displayPath(d.oldPath)}`;
  return null;
}

export function DiffBadge({ diff }: { diff: DiffEntry }) {
  const { icon, label } = DIFF_LABELS[diff.kind];
  const detail = diffDetail(diff);
  return (
    <span className={styles.badge} data-kind={diff.kind}>
      <span aria-hidden="true">{icon}</span>
      <span>{detail ? `${label}, ${detail}` : label}</span>
    </span>
  );
}

export function Tags({
  tags,
  indexTags,
}: {
  tags: readonly string[];
  indexTags: readonly string[];
}) {
  if (tags.length === 0 && indexTags.length === 0) return null;
  return (
    <>
      {tags.map((t) => (
        <span key={`p:${t}`} className={styles.tag} data-tag={t}>
          <span className={styles.srOnly}>variable </span>
          {t}
        </span>
      ))}
      {indexTags.map((t) => (
        <span key={`i:${t}`} className={cx(styles.tag, styles.indexTag)} data-tag={t}>
          <span className={styles.srOnly}>position variable </span>
          {t}
        </span>
      ))}
    </>
  );
}

export function ActiveMarker() {
  return (
    <span className={styles.activeMarker}>
      <span aria-hidden="true">▶</span>
      <span className={styles.srOnly}>current step</span>
    </span>
  );
}
