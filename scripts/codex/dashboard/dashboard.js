const projectsElement = document.querySelector("#projects");
const noticeElement = document.querySelector("#notice");
const searchElement = document.querySelector("#search");
const themeButton = document.querySelector("#theme-toggle");
let overview;

function savedTheme() {
  try {
    const value = localStorage.getItem("codex-dashboard-theme");
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function applyTheme(theme, persist = false) {
  document.documentElement.dataset.theme = theme;
  const dark = theme === "dark";
  themeButton.textContent = dark ? "Light mode" : "Dark mode";
  themeButton.setAttribute("aria-label", `Switch to ${dark ? "light" : "dark"} mode`);
  themeButton.setAttribute("aria-pressed", String(dark));
  if (persist) {
    try {
      localStorage.setItem("codex-dashboard-theme", theme);
    } catch {
      // The selected theme still applies for this page when storage is unavailable.
    }
  }
}

const initialTheme = savedTheme() ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
applyTheme(initialTheme);

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function dateLabel(value) {
  if (!value) return "Updated time unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Updated time unavailable" : date.toLocaleString();
}

function statusClass(status) {
  return String(status ?? "idle").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function renderProject(project) {
  const card = element("article", "project-card");
  const top = element("div", "project-top");
  const heading = element("div");
  if (project.repositoryUrl) {
    const link = element("a", "project-name", project.name);
    link.href = project.repositoryUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    heading.append(link);
  } else {
    heading.append(element("h3", "project-name", project.name));
  }
  if (project.roots?.[0]) heading.append(element("div", "project-path", project.roots[0]));
  top.append(heading, element("span", "project-count", `${project.threads.length} ${project.threads.length === 1 ? "task" : "tasks"}`));
  card.append(top);

  if (!project.threads.length) {
    card.append(element("div", "no-threads", "No active Codex tasks"));
    return card;
  }

  const list = element("div", "thread-list");
  for (const thread of project.threads) {
    const row = element("div", "thread-row");
    const details = element("div");
    details.append(element("div", "thread-title", thread.title));
    const meta = element("div", "thread-meta");
    meta.append(element("span", "", thread.source), element("span", "", dateLabel(thread.updatedAt)));
    details.append(meta);
    row.append(details, element("span", `status ${statusClass(thread.status)}`, thread.status));
    list.append(row);
  }
  card.append(list);
  return card;
}

function render() {
  if (!overview) return;
  const query = searchElement.value.trim().toLowerCase();
  const filtered = overview.projects.filter((project) => {
    const searchText = [project.name, project.repositoryUrl, ...project.roots, ...project.threads.map((thread) => `${thread.title} ${thread.cwd}`)].join(" ").toLowerCase();
    return searchText.includes(query);
  });
  projectsElement.replaceChildren();
  if (!filtered.length) {
    projectsElement.append(element("div", "empty-card", query ? "No projects match this filter." : "No Codex projects found."));
  } else {
    for (const project of filtered) projectsElement.append(renderProject(project));
  }

  document.querySelector("#project-count").textContent = String(overview.projectCount);
  document.querySelector("#thread-count").textContent = String(overview.activeThreadCount);
  document.querySelector("#task-id").textContent = overview.task?.currentTask?.id ?? "Not set";
  document.querySelector("#task-title").textContent = overview.task?.currentTask?.title ?? "No current task in TASKS.md";
  document.querySelector("#updated").textContent = `Updated ${dateLabel(overview.generatedAt)}`;
  document.querySelector("#source").textContent = overview.source;

  noticeElement.hidden = overview.projectListState === "available" && !overview.truncated;
  noticeElement.className = "notice";
  if (overview.projectListState === "unsupported") {
    noticeElement.textContent = "This installed Codex version does not expose project/list. Threads are grouped by workspace path; no private Codex files were scanned.";
  } else if (overview.truncated) {
    noticeElement.textContent = "The App Server page limit was reached. Some recent projects or tasks may not be shown.";
  }
}

async function refresh() {
  const button = document.querySelector("#refresh");
  button.disabled = true;
  try {
    const response = await fetch("/api/overview", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Codex data is unavailable.");
    overview = payload;
    render();
  } catch (error) {
    if (overview) {
      render();
      noticeElement.hidden = false;
      noticeElement.className = "notice error";
      noticeElement.textContent = `Refresh failed: ${error.message} Showing the last successful data.`;
    } else {
      noticeElement.hidden = false;
      noticeElement.className = "notice error";
      noticeElement.textContent = `${error.message} Check the Codex CLI connection, then refresh.`;
      projectsElement.replaceChildren(element("div", "empty-card", "Project data could not be loaded."));
      document.querySelector("#updated").textContent = "Connection unavailable";
    }
  } finally {
    button.disabled = false;
  }
}

document.querySelector("#refresh").addEventListener("click", refresh);
themeButton.addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", true);
});
searchElement.addEventListener("input", render);
refresh();
setInterval(refresh, 60_000);
