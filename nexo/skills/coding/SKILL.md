---
name: coding
description: Read surrounding code first, make small verified changes, match existing patterns, and verify code after editing before declaring work complete.
---

# Coding

## Before Writing Code

1. Read first: inspect the target file and closely related files before touching anything. Match naming, module boundaries, comment density, and local idioms.
2. Check build tools: look for `package.json`, `Cargo.toml`, `pom.xml`, `Makefile`, or similar files so you know the correct build and test commands.
3. Identify the impact area: frontend, Electron/server, shared types, build config, data/memory, packaging, or docs/skills.
4. Keep scope tight: implement only what was asked. Avoid unrelated cleanup, new abstractions, or broad rewrites unless they are needed to finish safely.

## Making Changes

- Prefer targeted edits over full rewrites. Only rewrite a file when the change touches most of it.
- Keep one concern per change. Do not mix unrelated refactors into feature or bug-fix work.
- Preserve user edits in dirty worktrees. Inspect relevant diffs before editing a file that already has changes.
- Use secure defaults: validate inputs, preserve path boundaries, avoid destructive commands, and use structured parsing when available.
- For multi-file changes, outline the plan briefly before starting.

## Git Safety

- Never run git restore, git checkout -- <path>, git reset, or any other git command that discards working-tree changes unless the user explicitly asks for that exact operation.
- Do not suggest git restore or checkout as the fix for a broken file. The user owns destructive git recovery decisions.
- If an edit breaks a file structure, repair the current file in place. Read the whole affected structure, remove or correct the bad markup/code, and verify the result.
- For Vue templates, do not rely on partial string replacement across `v-if` / `v-else`, `<template>`, or nested component boundaries unless the full structure has been inspected. If the template is malformed, fix the template structure directly and run the relevant typecheck/build.

## Verification

Code is not done until it has been verified. After every code change:

1. Run the smallest verification command that covers the changed area.
2. If the change touches runtime behavior, run the most relevant test or verification script too.
3. If verification fails, inspect the failure, fix the code, and rerun the same command before presenting the result.
4. If verification cannot be run because of environment limits, missing credentials, missing services, or a user instruction, say exactly why and name the command that should be run later.

For this Nexo Agent project, prefer these commands:

- Frontend/UI or `src/` only: `npm run build:web`, or `npm run typecheck` for type-only edits.
- Electron/server, tools, memory, routes, or `electron/`: `npm run build:electron`.
- Shared types, bundled metadata, skills/tools definitions, or cross-cutting changes: `npm run typecheck`.
- Context management behavior: `npm run verify:context-management`.
- Provider embedding or memory embedding behavior: `npm run verify:provider-embeddings`.
- Multimodal/model capability behavior: `npm run verify:multimodal-models`.
- Packaging/build pipeline behavior: `npm run build`; run OS package commands only when the user asks for distributables.

Do not use long-running dev server commands (`npm run dev`, `npm run dev:web`, `npm run dev:electron`) as verification because they do not exit. Use build, typecheck, or verify commands instead.

When a change edits only Markdown, docs, or a skill file, verify by checking the file content, frontmatter, JSON/YAML syntax if present, and any loader expectations. Run a compile step too if the docs or skill change affects bundled runtime metadata.

## Communicating Results

- State what changed and why.
- State the verification command or commands run and whether they passed.
- Reference changed locations as `file:line`.
- Call out tradeoffs when a choice has real alternatives.
- If verification was skipped, say why and name the command that should be run later.
