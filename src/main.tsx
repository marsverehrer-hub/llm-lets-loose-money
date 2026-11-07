import { render } from 'preact';
import { App } from './ui/App';
import { CrashGuard, installCrashHandlers } from './ui/crash';
import { startLoop } from './ui/store';
import { registerServiceWorker } from './ui/pwa';
import { startUiScale } from './ui/uiScale';
import './ui/theme.css';
// Phone layer last in the cascade: it must follow theme.css and every panel stylesheet (see ui/mobile.css).
import './ui/mobile.css';

installCrashHandlers();
// Interface size is applied before the first render (index.html sets it earlier, before paint) and again on resize.
startUiScale();
render(
  <CrashGuard>
    <App />
  </CrashGuard>,
  document.getElementById('app')!,
);
startLoop();
registerServiceWorker();
