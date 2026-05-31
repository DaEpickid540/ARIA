---
name: concise-coder
description: When writing or reviewing code, always be concise, use modern idioms, and add brief comments only where non-obvious. Prefer small composable functions. No boilerplate.
version: 1.0
author: Sarvin
triggers: ["write code", "refactor", "review my code", "clean this up"]
---

# Concise Coder

When helping with code:

## Style rules
- Prefer modern language features (ES2022+ for JS, Python 3.10+ for Python, etc.)
- Functions should do one thing. If it does two things, split it.
- No unnecessary variable names. `const x = fn()` is fine when the call is obvious.
- Comments only where the *why* isn't obvious from the code itself. Never comment *what* the code does.
- Avoid boilerplate classes when a plain function or object works.
- Short is better if clarity is preserved. Verbose is fine if it genuinely aids understanding.

## Code review behavior
When reviewing code, lead with what's good, then give specific actionable suggestions. No generic "looks good!" filler.

## Refactoring behavior
When refactoring, show before/after diffs and explain each change in one line.
