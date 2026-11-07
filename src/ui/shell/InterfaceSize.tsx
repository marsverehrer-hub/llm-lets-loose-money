// MENU row: "Interface size". Auto follows the window width (its label shows the value it gives now); the fixed steps
// override it. Phones always use 100%, so the row is hidden there.
import { Select, useIsMobile } from '../components';
import { UI_SCALE_STEPS, formatUiScale, parseUiScale, useUiScale } from '../uiScale';

export function InterfaceSizeRow() {
  const isPhone = useIsMobile();
  const { setting, auto, set } = useUiScale();
  if (isPhone) return null;
  return (
    <label class="menu-field">
      <span>Interface size</span>
      <Select
        class="menu-select"
        ariaLabel="Interface size"
        value={String(setting)}
        onChange={(v) => set(parseUiScale(v))}
        options={[
          { value: 'auto', label: `Auto (${formatUiScale(auto)})` },
          ...UI_SCALE_STEPS.map((s) => ({ value: String(s), label: formatUiScale(s) })),
        ]}
      />
    </label>
  );
}
