/**
 * Domain theme interface (design.md §10.1, Req 11.1). v1 registers only `fileExplorer`.
 * Implementations are assembled in app/, which is the only module allowed to import
 * sim/, export/, editor/ and playground/ together.
 */
import type { ComponentType } from 'react';
import type { CompositeSchema } from '../ir/composites.ts';
import type { OpSignature } from '../ir/ops.ts';
import type { Snapshot, Timeline } from '../ir/timeline.ts';

export interface DomainRendererProps<S> {
  snapshot: Snapshot<S>;
  prev?: Snapshot<S>;
  timeline: Timeline<S>;
  /** Called with node ids that touched the clicked item (click-to-trace, Req 7.7). */
  onTrace?: (nodeIds: string[]) => void;
}

export interface DomainTheme<S, Sc> {
  id: string;
  title: string;
  /** Domain ops (subset of the registry in ir/ops.ts with this domain). */
  ops: readonly OpSignature[];
  composites: readonly CompositeSchema[];
  scenarios: readonly Sc[];
  Renderer: ComponentType<DomainRendererProps<S>>;
}
