/** Validation problems with a "Show block" action for each one that has a block. */
import type { NodeId } from '../ir/types.ts';
import type { ValidationError } from '../ir/errors.ts';

const MAX_SHOWN = 8;

export function IssueList({
  issues,
  onShowBlock,
}: {
  issues: readonly ValidationError[];
  onShowBlock: (id: NodeId) => void;
}) {
  const shown = issues.slice(0, MAX_SHOWN);
  return (
    <ul className="issues">
      {shown.map((issue, i) => (
        <li key={`${issue.nodeId}:${issue.code}:${i}`}>
          {issue.message}{' '}
          {issue.nodeId && (
            <button type="button" className="link" onClick={() => onShowBlock(issue.nodeId)}>
              Show block
            </button>
          )}
        </li>
      ))}
      {issues.length > MAX_SHOWN && <li>…and {issues.length - MAX_SHOWN} more.</li>}
    </ul>
  );
}
