import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { createAppStore } from './app/store.ts';
import { applyTheme } from './app/settings.ts';
import { desugarFully, desugarOne, desugarProgram } from './composites/index.ts';
import { simulate } from './sim/index.ts';

const storage = (() => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
})();

const store = createAppStore({
  simulate,
  desugarProgram,
  desugarOne,
  desugarFully,
  storage,
  prefersDark: window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
});
// Apply the theme before the first paint to avoid a flash.
applyTheme(store.getState().settings);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App store={store} />
  </StrictMode>,
);
