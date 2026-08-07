import "./lib/polyfills";
import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import "./i18n";
import { LocaleProvider } from "./app/providers/LocaleProvider";
import { ThemeProvider } from "./app/providers/ThemeProvider";
import { ZoomProvider } from "./app/providers/ZoomProvider";
import { AuthProvider } from "./app/providers/AuthProvider";
import { router } from "./app/router";
import "./index.css";

// AuthProvider is the outermost content gate: it renders Administrator
// Setup or Login standalone (no AppShell, no router) until a session
// resolves, so the routed application — and every one of its routes —
// never mounts before authentication does. Locale/theme/zoom wrap it too,
// so the auth screens themselves are still themed and localized correctly.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LocaleProvider>
      <ThemeProvider>
        <ZoomProvider>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </ZoomProvider>
      </ThemeProvider>
    </LocaleProvider>
  </React.StrictMode>,
);
