import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, createShell } from './app/shell';
import { startI18n } from './i18n/i18n';
import { buildSettings, rootOptions, startReporting } from './reporting/reporting';
import { startTheme } from './theme/theme';
import './index.css';

// The error reports first, so that a fault of the start is reported too (task 0.10).
startReporting(buildSettings());

const root = document.getElementById('root');
if (!root) {
  throw new Error('index.html has no element with id "root".');
}

// The theme first: the page is light or dark before anything is drawn.
const theme = startTheme();
const i18n = startI18n();

createRoot(root, rootOptions()).render(
  <StrictMode>
    <App i18n={i18n} shell={createShell(i18n)} theme={theme} />
  </StrictMode>,
);
