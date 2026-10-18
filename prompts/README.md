# Prompt library

Versioned prompts. Each file starts with a front-matter block (`id`, `version`, `used_by`, `status`).
The application records the id, version and SHA-256 of every prompt it could use in the end-to-end trace.

| File | Used by | Status |
|---|---|---|
| `qa-composer.v1.md` | Module B optional LLM composer (`server/src/qa/llm.ts`) | Optional. Off unless `ANTHROPIC_API_KEY` is set. Never reachable from the safety rail. |
| `dev/` | Development-time instructions given to the coding assistant | Documentation of working method |

There is deliberately NO prompt for any safety check. The safety rail is pure lookup and arithmetic.
