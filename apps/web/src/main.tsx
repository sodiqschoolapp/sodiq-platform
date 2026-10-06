import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, createShell } from './app/shell';
import { startI18n } from './i18n/i18n';
import { startTheme } from './theme/theme';
import './index.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('index.html has no element with id "root".');
}

// The theme first: the page is light or dark before anything is drawn.
const theme = startTheme();

createRoot(root).render(
  <StrictMode>
    <App i18n={startI18n()} shell={createShell()} theme={theme} />
  </StrictMode>,
);
