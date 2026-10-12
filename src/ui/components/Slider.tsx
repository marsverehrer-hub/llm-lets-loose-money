export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** Accessible name, e.g. "Learning rate". */
  label: string;
  disabled?: boolean;
  class?: string;
}

const decimals = (step: number): number => (String(step).split('.')[1] ?? '').length;

/**
 * Range input with − and + step buttons. The buttons show only on phones (see ui/mobile.css), so a finger can nudge
 * a value that a thumb cannot place exactly. Desktop shows the plain slider.
 */
export function Slider({ value, min, max, step = 1, onChange, label, disabled, class: cls }: SliderProps) {
  const span = max - min || 1;
  const pct = `${Math.min(100, Math.max(0, ((value - min) / span) * 100))}%`;
  const set = (raw: number) => {
    const clamped = Math.min(max, Math.max(min, raw));
    onChange(Number(clamped.toFixed(decimals(step))));
  };
  return (
    <div class={`slider-row ${cls ?? ''}`}>
      <button
        type="button"
        class="slider-step"
        aria-label={`Decrease ${label}`}
        disabled={disabled || value <= min}
        onClick={() => set(value - step)}
      >
        −
      </button>
      <input
        type="range"
        class="slider"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ '--p': pct } as any}
        onInput={(e) => set(Number((e.currentTarget as HTMLInputElement).value))}
      />
      <button
        type="button"
        class="slider-step"
        aria-label={`Increase ${label}`}
        disabled={disabled || value >= max}
        onClick={() => set(value + step)}
      >
        +
      </button>
    </div>
  );
}
