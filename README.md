# ttasks-wtd

WTD workflow-shape retrieval companion for [`@ianphil/ttasks-ts`](https://github.com/ianphil/ttasks-ts).

This package lets ttasks consumers load a published WTD runtime bundle, retrieve
workflow-shape candidates from intent text or a draft ttasks DAG, and feed the
structured guidance back into graph authoring.

WTD recommends shapes; ttasks still owns executable `TaskGraph` construction and
execution.

## Install

```bash
pnpm add github:ianphil/ttasks-wtd#v0.1.0
```

Use it with a pinned WTD runtime bundle, such as `ianphil/wtd-mixed-v1@v0.4.0`.

```bash
hf download ianphil/wtd-mixed-v1 \
  --revision v0.4.0 \
  --local-dir ./models/wtd-mixed-v1
```

## Usage

```ts
import { WtdAdvisor } from '@ianphil/ttasks-wtd';

const advisor = await WtdAdvisor.load({
  bundlePath: './models/wtd-mixed-v1',
});

const candidates = advisor.retrieve({
  query: 'dataset ingestion eval publish candidate',
  k: 5,
});
```

Draft-DAG retrieval uses the shared ttasks JSON shape:

```ts
const candidates = advisor.retrieve({
  draftDag: {
    id: 'draft',
    title: 'fix branches verify merge',
    nodes: [],
    deps: {},
    finallyTasks: [],
    optionalTasks: [],
  },
  k: 5,
});
```

## Scope

- Loads local WTD runtime bundle metadata.
- Verifies `checksums.json` when present.
- Provides dependency-light text fallback retrieval.
- Defines the ttasks draft-DAG JSON contract for WTD queries.

Structural ONNX retrieval belongs behind this package API once the native runtime
dependency boundary is settled.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## License

MIT
