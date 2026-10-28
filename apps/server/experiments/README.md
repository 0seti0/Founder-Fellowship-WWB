# Generation experiments

The prompt fixtures are synthetic development examples, not observations of
real user behavior. Mock-provider results are useful for exercising the
pipeline and harness, but they do not establish candidate quality or predict
human judgments.

Run the default six-strategy comparison against all 20 fixtures with:

```sh
pnpm --filter @unfold/server experiment --
```

The harness defaults to `MODEL_MODE=mock` when no mode is configured. Use
`--strategies a,b`, `--fixtures path`, `--seed s`, and `--out dir` to select
strategy arms, fixture inputs, deterministic exploration strings, or an output
directory. It writes `results.jsonl` and a blank-label `human-review.csv` under
`experiments/out/<timestamp>/` by default. The output directory is gitignored.

Functional-equivalence judgments are development measurements only. They are
not a production hard filter, and the reported metrics remain separate rather
than combining into an automatic aligned-novelty score.
