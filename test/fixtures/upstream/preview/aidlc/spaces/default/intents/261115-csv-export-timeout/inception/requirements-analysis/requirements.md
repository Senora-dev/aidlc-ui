# Requirements

> Stage: `requirements-analysis`

## Summary

This document was produced during **requirements-analysis** for the request. It records the agreed outcome.

## Details

- Point one
- Point two

| Item | Decision |
| --- | --- |
| Timeout | 30s, streamed |

```ts
export const TIMEOUT_MS = 30_000;
```

## Retry behaviour

Retries use exponential backoff.
