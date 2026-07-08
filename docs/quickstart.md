# Quickstart: ttasks-ts + WTD

Use `@ianphil/ttasks-ts` as the execution engine and `@ianphil/ttasks-wtd` as
the workflow topology advisor.

WTD recommends proven workflow shapes. Your code or agent still authors and runs
the concrete `TaskGraph`.

## 1. Install

```bash
pnpm add github:ianphil/ttasks-ts#v0.3.0
pnpm add github:ianphil/ttasks-wtd#main
```

## 2. Download and load the WTD runtime

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
```

`downloadWtdRuntime` uses Node's built-in `fetch`; it does not require the
Hugging Face CLI or Python.

## 3. Describe the workflow you intend to build

Start with compact draft steps when the workflow is still rough:

```ts
const draftDag = {
  title: 'fix branches verify merge',
  steps: [
    'Inspect failing branches',
    'Fix each branch',
    'Run tests',
    'Merge passing branches',
    'Publish summary',
  ],
};
```

Use canonical graph JSON when you already know the DAG structure:

```ts
const draftDag = {
  id: 'deep-claim-verification',
  title: 'deep claim verification',
  nodes: [
    {
      id: 'extract-claims',
      title: 'Extract claims from source data',
      type: 'prompt',
      description: '',
      payload: 'Extract claims from source data',
      timeout: null,
      metadata: {},
    },
  ],
  deps: {
    'extract-claims': [],
  },
  finallyTasks: [],
  optionalTasks: [],
};
```

## 4. Ask WTD for topology candidates

```ts
const result = await advisor.retrieve({
  draftDag,
  mode: 'structural',
  k: 5,
});

for (const candidate of result.candidates) {
  console.log(candidate.id, candidate.score, candidate.rankReason);
}
```

Draft-DAG retrieval runs the structural runtime:

```text
draft DAG
→ graph tensors
→ encoder.onnx
→ latents.f16 nearest neighbors
→ ranker-config.json reranking
→ workflow-shape candidates
```

Set `rank: false` to inspect raw ONNX nearest-neighbor results before heuristic
reranking.

## 5. Turn the selected shape into a real TaskGraph

If WTD recommends a fan-out/synthesis shape, author parallel branches followed by
a synthesis task:

```ts
import {
  Task,
  TaskExecutor,
  TaskGraph,
  TaskType,
  createBashHandler,
} from '@ianphil/ttasks-ts';

const exec = new TaskExecutor();
exec.register(TaskType.BASH, createBashHandler());

const graph = new TaskGraph({ title: 'fix-verify-merge' });

const inspect = Task.bash('echo inspect', { title: 'Inspect branches' });
const fixA = Task.bash('echo fix A', { title: 'Fix branch A' });
const fixB = Task.bash('echo fix B', { title: 'Fix branch B' });
const verify = Task.bash('echo verify', { title: 'Verify all fixes' });

graph.add(inspect);
graph.add(fixA, { after: [inspect] });
graph.add(fixB, { after: [inspect] });
graph.add(verify, { after: [fixA, fixB] });

await graph.run(exec);
```

## 6. Iterate

Use WTD before or during graph authoring:

```text
intent or draft DAG
→ WTD recommends topology
→ author concrete TaskGraph
→ run with ttasks-ts
→ revise the graph and ask WTD again when needed
```

The package includes fixture drafts in `examples/topology-drafts/` for common
workflow-shape families.
