import { useEffect, useState } from 'preact/hooks';

/** Phone layout breakpoint. Keep in step with the @media (max-width: 760px) blocks in ui/mobile.css. */
export const MOBILE_MAX_WIDTH = 760;
export const MOBILE_QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px)`;

function matches(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(MOBILE_QUERY).matches;
  } catch {
    return false;
  }
}

/** True at 760px wide and below. Re-renders when the breakpoint is crossed. Use it to switch markup; use CSS for spacing. */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(matches);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setMobile(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}
