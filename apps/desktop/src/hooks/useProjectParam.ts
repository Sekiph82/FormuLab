import { useSearchParams } from "react-router-dom";

/**
 * Reads/writes the `project`/`version` query params every project-bound
 * workspace page (Laboratory/Stability/Optimization/Regulatory/Approval/
 * Formulation) shares, so navigating between workspaces — or refreshing the
 * page — preserves which project and version the user was looking at. See
 * docs/NAVIGATION_AND_CONTEXT.md.
 */
export function useProjectParam() {
  const [params, setParams] = useSearchParams();
  const projectId = params.get("project");
  const versionId = params.get("version");

  const setProject = (id: string | null) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set("project", id);
      else next.delete("project");
      next.delete("version");
      return next;
    });
  };

  const setVersion = (id: string | null) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set("version", id);
      else next.delete("version");
      return next;
    });
  };

  return { projectId, versionId, setProject, setVersion };
}
