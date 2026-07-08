# ttasks-wtd

WTD workflow-shape retrieval companion for [`@ianphil/ttasks-ts`](https://github.com/ianphil/ttasks-ts).

This package lets ttasks consumers download and load a published WTD runtime
bundle, run structural `encoder.onnx` inference over a draft ttasks DAG, retrieve
workflow-shape candidates, and feed the structured guidance back into graph
authoring.

WTD recommends shapes; ttasks still owns executable `TaskGraph` construction and
execution.

## Install

```bash
pnpm add github:ianphil/ttasks-wtd#v0.1.0
```

Use it with a pinned WTD runtime bundle, such as `ianphil/wtd-mixed-v1@v0.4.1`.

For the end-to-end `ttasks-ts` + WTD flow, see
[`docs/quickstart.md`](./docs/quickstart.md).

## Usage

```ts
import { downloadWtdRuntime, WtdAdvisor } from '@ianphil/ttasks-wtd';

const runtime = await downloadWtdRuntime({
  repo: 'ianphil/wtd-mixed-v1',
  revision: 'v0.4.1',
  outDir: './models/wtd-mixed-v1',
});

const advisor = await WtdAdvisor.load({
  bundlePath: runtime.bundlePath,
});

const result = await advisor.retrieve({
  query: 'dataset ingestion eval publish candidate',
  k: 5,
});

console.log(result.candidates);
```

Draft-DAG retrieval uses the full structural runtime when the bundle includes
`encoder.onnx`, `latents.f16`, and `text-projection.f32`:

```ts
const result = await advisor.retrieve({
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
- Downloads pinned Hugging Face runtime revisions.
- Verifies `checksums.json` when present.
- Runs structural draft-DAG retrieval through `encoder.onnx`.
- Applies `ranker-config.json` heuristic reranking and feature explanations.
- Provides dependency-light text fallback retrieval.
- Defines the ttasks draft-DAG JSON contract for WTD queries.

Text queries use metadata retrieval. Draft-DAG queries use ONNX structural
retrieval when structural files are present, and fall back to metadata retrieval
only when the caller allows `mode: 'auto'`. Set `rank: false` to inspect raw
nearest-neighbor ONNX retrieval before heuristic reranking.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## License

MIT
