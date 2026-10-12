import type { ComponentChildren } from 'preact';

export interface TabDef<T extends string> {
  id: T;
  label: ComponentChildren;
  icon?: string;
  count?: number;
  disabled?: boolean;
}

export interface TabsProps<T extends string> {
  tabs: TabDef<T>[];
  value: T;
  onChange: (id: T) => void;
  /** underline = section tabs (default). segmented = pill toggle group. */
  variant?: 'underline' | 'segmented';
  class?: string;
}

export function Tabs<T extends string>({ tabs, value, onChange, variant = 'underline', class: cls }: TabsProps<T>) {
  if (variant === 'segmented') {
    return (
      <div class={`segmented ${cls ?? ''}`} role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === value}
            class={`seg ${t.id === value ? 'active' : ''}`}
            disabled={t.disabled}
            onClick={() => onChange(t.id)}
          >
            {t.icon && <span>{t.icon}</span>}
            {t.label}
            {t.count !== undefined && <span class="tab-count">{t.count}</span>}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div class={`tabs ${cls ?? ''}`} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          class={`tab ${t.id === value ? 'active' : ''}`}
          disabled={t.disabled}
          onClick={() => onChange(t.id)}
        >
          {t.icon && <span>{t.icon}</span>}
          {t.label}
          {t.count !== undefined && <span class="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
