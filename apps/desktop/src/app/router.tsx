import { createBrowserRouter, Navigate, type RouteObject } from "react-router-dom";
import { AppShell } from "./layout/AppShell";
import { SessionPage } from "./routes/SessionPage";
import { FormulationWorkspaceV2 } from "@/components/thread/FormulationWorkspaceV2";
import { NotebooksPage } from "./routes/NotebooksPage";
import { OptimizerPage } from "./routes/OptimizerPage";
import { FilesPage } from "./routes/FilesPage";
import { FormulasPage } from "./routes/FormulasPage";
import { MaterialsPage } from "./routes/MaterialsPage";
import { RunsPage } from "./routes/RunsPage";
import { SettingsPage } from "./routes/SettingsPage";
import { NotFound } from "./routes/NotFound";

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/live" replace /> },
      { path: "live", element: <FormulationWorkspaceV2 /> },
      { path: "live/:sessionId", element: <FormulationWorkspaceV2 /> },
      { path: "example/:sessionId", element: <SessionPage /> },
      { path: "formulas", element: <FormulasPage /> },
      { path: "materials", element: <MaterialsPage /> },
      { path: "notebooks", element: <NotebooksPage /> },
      { path: "optimizer", element: <OptimizerPage /> },
      { path: "files", element: <FilesPage /> },
      { path: "runs", element: <RunsPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "settings/:section", element: <SettingsPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
