import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { activateEnglishFallback, initializeI18n } from "./i18n";

interface BootstrapDependencies {
  initialize: () => Promise<unknown>;
  activateEnglishFallback: () => Promise<unknown>;
  render: () => void;
}

function renderApp(): void {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

export async function bootstrap(
  dependencies: BootstrapDependencies = {
    initialize: initializeI18n,
    activateEnglishFallback,
    render: renderApp,
  },
): Promise<void> {
  try {
    await dependencies.initialize();
  } catch {
    try {
      await dependencies.activateEnglishFallback();
    } catch {
      // Rendering the English fallback remains preferable to a blank root.
    }
  } finally {
    dependencies.render();
  }
}
