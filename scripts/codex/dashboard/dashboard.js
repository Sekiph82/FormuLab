const projectsElement = document.querySelector("#projects");
const threadsElement = document.querySelector("#threads");
const noticeElement = document.querySelector("#notice");
const searchElement = document.querySelector("#search");
const projectSelect = document.querySelector("#project-select");
const taskSummaryElement = document.querySelector("#task-summary");
const taskDetailsElement = document.querySelector("#task-details");
const selectedProjectElement = document.querySelector("#selected-project");
const questionsSection = document.querySelector("#owner-questions");
const questionsList = document.querySelector("#questions-list");
const themeButton = document.querySelector("#theme-toggle");
let overview;
let selectedProjectId = readSelectedProject();

function readSelectedProject() {
  try {
    return localStorage.getItem("codex-dashboard-project") ?? "";
  } catch {
    return "";
  }
}

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

function isActiveStatus(status) {
  return ["active", "running", "inprogress", "waiting", "needsattention"].includes(statusClass(status));
}

function activityLabel(project) {
  const activeCount = project.threads.filter((thread) => isActiveStatus(thread.status)).length;
  if (activeCount) return `${activeCount} active Codex ${activeCount === 1 ? "task" : "tasks"}`;
  const unloadedCount = project.threads.filter((thread) => statusClass(thread.status) === "notloaded").length;
  if (unloadedCount) return `No live status for ${unloadedCount} saved ${unloadedCount === 1 ? "thread" : "threads"} in the read-only App Server list.`;
  return "No Codex task is currently running or awaiting attention.";
}

function persistSelectedProject(projectId) {
  try {
    localStorage.setItem("codex-dashboard-project", projectId);
  } catch {
    // Project selection still applies until this page is closed.
  }
}

function renderSelectedProject(project) {
  const details = [
    element("strong", "selected-project-name", project.name),
    element("span", "selected-project-activity", activityLabel(project)),
  ];
  if (project.roots?.[0]) details.push(element("span", "selected-project-path", project.roots[0]));
  if (project.repositoryUrl) {
    const link = element("a", "repository-link", "Open repository");
    link.href = project.repositoryUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    details.push(link);
  }
  selectedProjectElement.replaceChildren(...details);
}

function render() {
  if (!overview) return;
  const projects = overview.projects ?? [];
  const currentSelectionExists = projects.some((project) => project.id === selectedProjectId);
  if (!currentSelectionExists) {
    selectedProjectId = projects.find((project) => project.id === "formulab" || project.name.toLowerCase() === "formulab")?.id ?? projects[0]?.id ?? "";
    persistSelectedProject(selectedProjectId);
  }

  projectSelect.replaceChildren();
  for (const project of projects) {
    const option = element("option", "", project.name);
    option.value = project.id;
    projectSelect.append(option);
  }
  projectSelect.value = selectedProjectId;

  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const query = searchElement.value.trim().toLowerCase();
  const filteredThreads = (selectedProject?.threads ?? []).filter((thread) =>
    `${thread.title} ${thread.cwd} ${thread.status} ${thread.source}`.toLowerCase().includes(query)
  );
  const isFormuLab = selectedProject && (selectedProject.id === "formulab" || selectedProject.name.toLowerCase() === "formulab");
  const filteredJobs = (isFormuLab ? overview.jobs ?? [] : []).filter((job) =>
    `${job.id} ${job.task} ${job.stage}`.toLowerCase().includes(query)
  );
  projectsElement.replaceChildren();
  if (!selectedProject) {
    projectsElement.append(element("div", "empty-card", "No selected projects are available."));
    selectedProjectElement.replaceChildren();
    threadsElement.replaceChildren(element("div", "empty-card", "No project selected."));
  } else {
    renderSelectedProject(selectedProject);
    projectsElement.append(renderBoard(filteredJobs, isFormuLab, query));
    threadsElement.replaceChildren(...(filteredThreads.length
      ? filteredThreads.map(renderThread)
      : [element("div", "empty-card", query ? "No threads match this filter." : "No Codex threads for this project yet.")]));
  }

  document.querySelector("#project-count").textContent = String(overview.projectCount);
  document.querySelector("#thread-count").textContent = String(overview.activeThreadCount ?? projects.reduce((count, project) => count + project.threads.length, 0));
  taskSummaryElement.hidden = !isFormuLab;
  taskDetailsElement.hidden = !isFormuLab;
  const task = isFormuLab ? overview.task : null;
  questionsSection.hidden = !isFormuLab;
  if (isFormuLab) renderQuestions(overview.questions ?? []);
  else questionsList.replaceChildren();
  document.querySelector("#task-id").textContent = task?.currentTask?.id ?? (isFormuLab ? "Not set" : "—");
  document.querySelector("#task-title").textContent = task?.currentTask?.title ?? (isFormuLab ? "No current task in TASKS.md" : "Select FormuLab to view its task state");
  document.querySelector("#task-status").textContent = task?.currentTaskStatus ?? "—";
  document.querySelector("#task-scope").textContent = [task?.milestone, task?.sprint].filter(Boolean).join(" / ") || "—";
  document.querySelector("#next-task").textContent = task?.nextTask ?? "—";
  document.querySelector("#completion").textContent = task?.completion ?? "—";
  document.querySelector("#project-subtitle").textContent = selectedProject
    ? `${filteredJobs.length} workflow ${filteredJobs.length === 1 ? "job" : "jobs"} · refreshes every 2 seconds`
    : "Choose a project to see its latest Codex work";
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

function renderQuestions(questions) {
  questionsList.replaceChildren();
  if (!questions.length) {
    questionsList.append(element("p", "no-questions", "No owner decisions are waiting."));
    return;
  }
  for (const question of questions) {
    const card = element("article", "question-card");
    const heading = element("div", "question-topline");
    heading.append(element("strong", "question-id", question.id), element("span", "question-task", question.taskId));
    card.append(heading, element("p", "question-prompt", question.question));
    if (question.answer) {
      card.append(element("p", "answer-received", `Answer received · ${dateLabel(question.answer.submittedAt)}`));
      card.append(element("blockquote", "question-answer", question.answer.answer));
    } else {
      const form = element("form", "answer-form");
      const input = element("textarea", "answer-input");
      input.name = "answer";
      input.rows = 3;
      input.maxLength = 4_000;
      input.placeholder = "Type your decision or answer";
      input.required = true;
      input.setAttribute("aria-label", `Answer ${question.id}`);
      const submit = element("button", "answer-submit", "Send answer");
      submit.type = "submit";
      const status = element("span", "answer-status", "");
      form.append(input, submit, status);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const answer = input.value.trim();
        if (!answer) return;
        submit.disabled = true;
        status.textContent = "Saving answer…";
        try {
          const response = await fetch("/api/owner-answers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ questionId: question.id, answer }),
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || "Answer could not be saved.");
          status.textContent = "Answer saved. The automation will apply it at the next task boundary.";
          await refresh();
        } catch (error) {
          status.textContent = error.message;
          submit.disabled = false;
        }
      });
      card.append(form);
    }
    questionsList.append(card);
  }
}

const boardStages = ["SPEC", "BUILD", "REVIEW", "APPROVE", "MERGED", "ESCALATED"];

function renderBoard(jobs, isFormuLab, query) {
  const board = element("div", "activity-board");
  board.setAttribute("aria-label", "Project activity kanban");
  for (const stage of boardStages) {
    const column = element("section", `board-column stage-${stage.toLowerCase()}`);
    column.setAttribute("aria-label", `${stage} stage`);
    const heading = element("h3", "column-title", stage);
    column.append(heading);
    const stageJobs = jobs.filter((job) => job.stage === stage);
    if (stageJobs.length) {
      for (const job of stageJobs) column.append(renderJob(job));
    } else {
      const message = !isFormuLab
        ? "Workflow stage data is not available for this project."
        : query && !jobs.length
          ? "No matching jobs."
          : stage === "BUILD" && !jobs.length
            ? "No active workflow job."
            : "";
      if (message) column.append(element("p", "column-empty", message));
    }
    board.append(column);
  }
  return board;
}

function renderJob(job) {
  const card = element("article", `job-card${job.stage === "ESCALATED" ? " escalated" : ""}`);
  card.append(element("h4", "job-title", job.id));
  card.append(element("p", "job-description", job.task));
  if (job.stage === "BUILD" || job.stage === "REVIEW") card.append(element("p", "job-round", `round ${job.round}`));
  const chips = element("div", "review-chips");
  for (const lens of ["rules", "code", "tests"]) {
    const status = job.reviews?.[lens] ?? "pending";
    chips.append(element("span", `review-chip ${status}`, lens));
  }
  card.append(chips);
  return card;
}

function renderThread(thread) {
  const row = element("article", "thread-card");
  const details = element("div", "thread-card-main");
  details.append(element("h3", "thread-title", thread.title));
  const meta = element("div", "thread-meta");
  meta.append(element("span", "", thread.source), element("span", "", dateLabel(thread.updatedAt)));
  if (thread.cwd) meta.append(element("span", "thread-path", thread.cwd));
  details.append(meta);
  const status = element("span", `status ${statusClass(thread.status)}`, thread.status);
  status.setAttribute("aria-label", `Task status: ${thread.status}`);
  row.append(details, status);
  return row;
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
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
    refreshing = false;
  }
}

let refreshing = false;

document.querySelector("#refresh").addEventListener("click", refresh);
themeButton.addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", true);
});
searchElement.addEventListener("input", render);
projectSelect.addEventListener("change", () => {
  selectedProjectId = projectSelect.value;
  persistSelectedProject(selectedProjectId);
  searchElement.value = "";
  render();
});
refresh();
setInterval(refresh, 2_000);
