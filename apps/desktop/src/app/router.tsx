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
import { HomePage } from "./routes/HomePage";
import { ProjectsPage } from "./routes/ProjectsPage";
import { FormulationPage } from "./routes/FormulationPage";
import { LaboratoryPage } from "./routes/LaboratoryPage";
import { StabilityPage } from "./routes/StabilityPage";
import { OptimizationPage } from "./routes/OptimizationPage";
import { RegulatoryPage } from "./routes/RegulatoryPage";
import { ApprovalPage } from "./routes/ApprovalPage";
import { ReportsPage } from "./routes/ReportsPage";
import { AdministrationPage } from "./routes/AdministrationPage";
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
      // Retained: the old single-page Formula Builder with every downstream
      // module as a horizontal tab. /formulas now redirects to /projects,
      // the new home for the project list; the page itself stays mounted
      // (unremoved) so no existing deep link or persisted reference breaks.
      { path: "formulas", element: <Navigate to="/projects" replace /> },
      { path: "formulas/legacy", element: <FormulasPage /> },
      { path: "home", element: <HomePage /> },
      { path: "projects", element: <ProjectsPage /> },
      { path: "formulation", element: <FormulationPage /> },
      { path: "laboratory", element: <LaboratoryPage /> },
      { path: "stability", element: <StabilityPage /> },
      { path: "optimization", element: <OptimizationPage /> },
      { path: "regulatory", element: <RegulatoryPage /> },
      { path: "approval", element: <ApprovalPage /> },
      { path: "reports", element: <ReportsPage /> },
      { path: "administration", element: <AdministrationPage /> },
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
