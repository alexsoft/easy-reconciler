# Example Prompts

Representative prompts used during the build, in roughly chronological order.

Also check [`docs/prompts/**`](/docs/prompts).

**1. Brainstorming-driven design session**

> Task to be done is described in @task/task.md. Let's plan how to implement it in Fastify + Drizzle + Postgres + React + TanStack Query stack. We will use docker compose for everything. First part is to have baseline with db and script that can match by ids. Then next part is for handling some heuristics to handle special cases. Then last part will be UI for the matched and not matched things.

Triggered a multi-turn Q&A that nailed down LLM vs deterministic approach, data model, confidence tiers, auth scope, and UI shape - all before a line of code was written.

---

**2. Semantic bug via observed behavior**

> After I saved, status is auto_matched but technically it is not right.

One sentence. No stack trace, no file reference. Produced a precise root-cause analysis (update-tx-status.ts:27 doesn't check source), a fix plan across 5 files, new test, and passing suite.

---

**3. Backlog creation from review findings**

> Store these issues into a file with ways to then control what has been fixed. I will need to have it fix step by step.

Turned the raw parallel-agent review output into a structured BACKLOG.md with checkboxes, severity tiers, and fix descriptions — immediately usable for incremental work.

---

**4. Review**

> Review the project from following points of view: performance, code quality, code organization, security. You can use sub agents.
  In the end create a table with comments and short descriptions how to improve that

Produced a good quality list of things to fix: N+1 queries, missing indexes, some possible DoS vectors, possible issues with authorization, missing validation rules, etc.
