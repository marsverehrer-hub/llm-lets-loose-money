import type { ComponentChildren } from 'preact';
import { useIsMobile } from './useIsMobile';

export interface DataColumn<T> {
  key: string;
  /** Header text, sentence case. Also the label on stacked cards. */
  label: string;
  /** Right-aligned mono numbers. */
  num?: boolean;
  /** The first column becomes the card heading on phones. Default: the first column. */
  primary?: boolean;
  cell: (row: T) => ComponentChildren;
}

export interface DataTableProps<T> {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowClass?: (row: T) => string;
  /**
   * How the table fits a phone.
   * - `stack` (default): on phones each row becomes a stacked card (heading = primary column, label/value lines for the rest).
   * - `scroll`: stays a table on phones, scrolls sideways inside its card, and the first column stays pinned.
   */
  mobile?: 'stack' | 'scroll';
  /** Shown instead of the table when there are no rows. */
  empty?: ComponentChildren;
  /** Accessible name for the table or list. */
  label: string;
}

/**
 * Responsive list of records. On desktop it is the normal `.table` (see theme.css). On phones it follows `mobile`.
 * Read ui/components/MOBILE.md before using it.
 */
export function DataTable<T>({ columns, rows, rowKey, rowClass, mobile = 'stack', empty, label }: DataTableProps<T>) {
  const isPhone = useIsMobile();
  if (rows.length === 0) return <>{empty ?? null}</>;

  const primary = columns.find((c) => c.primary) ?? columns[0];
  const rest = columns.filter((c) => c !== primary);

  if (isPhone && mobile === 'stack') {
    return (
      <ul class="stack-cards" aria-label={label}>
        {rows.map((row) => (
          <li key={rowKey(row)} class={`stack-card ${rowClass?.(row) ?? ''}`}>
            <div class="stack-card-head">{primary.cell(row)}</div>
            <dl class="stack-card-body">
              {rest.map((c) => (
                <div key={c.key} class="stack-kv">
                  <dt>{c.label}</dt>
                  <dd class={c.num ? 'num' : undefined}>{c.cell(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    );
  }

  const scroll = isPhone && mobile === 'scroll';
  return (
    <div class={`table-wrap ${scroll ? 'table-scroll' : ''}`}>
      <table class="table" aria-label={label}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} class={c.num ? 'num' : undefined} scope="col">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} class={rowClass?.(row)}>
              {columns.map((c) => (
                <td key={c.key} class={c.num ? 'num' : undefined} data-label={c.label}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
