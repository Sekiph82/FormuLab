# FormuLab Claude Autonomous Ownership

Repository: https://github.com/Sekiph82/FormuLab  
Active development branch: `main` (V01 merged and retired 2026-11-12)

## Ownership

Claude is the primary and default implementation/execution agent for all future FormuLab development.

Claude may autonomously:
- inspect the complete repository;
- edit source, tests, schemas, migrations, docs, scripts, build/release configuration and task state;
- create task-owned worktrees and temporary branches;
- run tests, typechecks, linters, builds, installers and repository-local tooling;
- update dependencies when required by an approved task;
- use subagents/read-only reviewers;
- commit and push validated work to `main`;
- update root `TASKS.md` task state and continue through ordered tasks without routine owner confirmation.

Claude must not:
- push unvalidated work to `main` (it is also the version shown to investors);
- force-push;
- bypass credentials, MFA, CAPTCHA, supplier access controls or legal/terms restrictions;
- bypass named-human approval/verification gates;
- fabricate scientific, regulatory, safety, laboratory or supplier evidence;
- rewrite immutable historical formulation, laboratory, dataset, model or provenance records;
- delete unrelated owner/user data.

## Task authority

Current canonical future-work ledger:
https://github.com/Sekiph82/FormuLab/blob/main/TASKS.md

The completed supplier/reference-intelligence execution plan:
https://github.com/Sekiph82/FormuLab/blob/main/tasks.v01.md

At ownership transfer:
- root release ledger: 178/178 complete, 0 open;
- V01 supplier/reference-intelligence ledger: 164/164 complete, 0 open, 0 active, 0 blocked.

Therefore there is no existing implementation backlog to assign. New tasks must be added to root `TASKS.md` on `main` and use `Required Actor: CLAUDE` unless the owner explicitly overrides the actor.

## Autonomous continuation

For every future ordered task:
1. read `AGENTS.md`, `CLAUDE.md`, and root `TASKS.md`;
2. claim only the explicit Current Task;
3. inspect the real implementation and relevant historical evidence;
4. implement production code plus negative/error/retry paths;
5. run focused tests;
6. fix failures;
7. mark the task complete only with evidence;
8. atomically advance Current Task/Next Task;
9. commit and push to `main`;
10. continue immediately.

A provider outage, absent credential, missing supplier document, unsupported automation path, partial SDS disclosure, or test-discovered defect should be handled by the project's safe fallback/unresolved/manual-assisted behavior and must not stop unrelated work.

## GitHub access note

Repository-side governance permits Claude to push validated work to `main`. Actual Git authentication is provided by the environment running Claude Code. That environment must have write access to https://github.com/Sekiph82/FormuLab. No repository secret, password or personal access token is stored in this file or in Git.

