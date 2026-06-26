---
name: script-memory
description: Convert repeated user workflows into deterministic runnable scripts and keyed Nexo script memories. Use whenever the user says to remember a process, create script memory, fix a workflow structure for next time, make a flow stable/reusable, or in Chinese says “脚本记忆”, “记住这个流程”, “固定流程”, “下次复用”, “稳定运行”.
---

# Script Memory

Use this skill when the user wants a process to run the same way next time. A script memory is a durable, keyed workflow record stored in Nexo memory with enough detail for a future session to reuse the same script, command, inputs, outputs, and checks.

## Create Or Update

1. Clarify only the missing essentials: workflow purpose, required inputs, expected outputs, and success check.
2. Search existing script memories first with `recall_memory` using `kinds: ["script"]`.
3. If a close memory exists, update that key instead of creating a duplicate.
4. Convert the workflow into a deterministic script or command path:
   - Prefer an actual repo script when the workflow touches files or runs multiple steps.
   - Prefer the project's existing language and scripts.
   - Keep parameters explicit instead of relying on hidden chat context.
5. Verify the script with `--help`, a dry run, typecheck, build, or the smallest safe command that proves it works.
6. Store the final workflow with `store_script_memory`.

## Memory Content Format

Store script memory content in this exact Markdown shape:

    # <Workflow Name>

    Purpose: <one sentence>

    Trigger phrases:
    - <phrase the user may say later>

    Inputs:
    - <name>: <required/optional, description, default if any>

    Stable steps:
    1. <step>
    2. <step>

    Command:
    <exact command to run>

    Outputs:
    - <path or result>: <description>

    Verification:
    - <command or check>: <what it proves>

    Notes:
    - <constraints, assumptions, or known limits>

Use a stable key such as `workflow:<slug>` or `project:<project-slug>:<workflow-slug>`.

## Reuse

When the user asks to run a remembered process:

1. Call `recall_memory` with `kinds: ["script"]` and the user's wording.
2. Read the remembered command, inputs, and verification before acting.
3. Run the stored script or command as written when it still fits.
4. If the workflow needs a small change, keep backward compatibility and update the same script memory afterward.

## Final Reply

After storing or updating a script memory, reply with:

- the memory key
- the script or command to reuse
- the verification that passed
- any missing input the user must provide next time
