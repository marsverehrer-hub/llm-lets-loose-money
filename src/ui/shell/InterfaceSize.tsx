// MENU row: "Interface size". Auto follows the window width (its label shows the value it gives now); the fixed steps
// override it. Phones always use 100%, so the row is hidden there.
import { useIsMobile } from '../components';
import { UI_SCALE_STEPS, formatUiScale, parseUiScale, useUiScale } from '../uiScale';

export function InterfaceSizeRow() {
  const isPhone = useIsMobile();
  const { setting, auto, set } = useUiScale();
  if (isPhone) return null;
  return (
    <label class="menu-field">
      <span>Interface size</span>
      <select
        class="select menu-select"
        aria-label="Interface size"
        value={String(setting)}
        onChange={(e) => set(parseUiScale((e.target as HTMLSelectElement).value))}
      >
        <option value="auto">{`Auto (${formatUiScale(auto)})`}</option>
        {UI_SCALE_STEPS.map((s) => (
          <option key={s} value={String(s)}>
            {formatUiScale(s)}
          </option>
        ))}
      </select>
    </label>
  );
}
