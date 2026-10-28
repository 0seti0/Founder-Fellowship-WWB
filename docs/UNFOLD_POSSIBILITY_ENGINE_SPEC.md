# Unfold possibility engine spec

## Product kernel

Unfold is a visual possibility engine for an underspecified prompt. It proposes
meaningfully different deeper-goal directions without asking follow-up
questions; the user steers the graph, and a selected ancestry becomes an
editable action brief. The persisted typed idea DAG is authoritative. Models
propose schema-validated candidates, while deterministic preconditions and
restricted transactional graph patches control mutations.

The objective is aligned novelty: directions should remain faithful to the
prompt while offering meaningfully distinct options. It is a qualitative
product objective, not a single automatic score. The profile, constraints,
evidence, and graph boundaries described in `AGENTS.md` remain in force.

## Pipeline

Every model call in a run receives the same `currentDate` (date, weekday, and
effective timezone).

1. **Extract.** `extract-v3` returns explicit facts and constraints. Each
   evidence span must be an exact contiguous substring of the original prompt.
   Inferred goal hypotheses are not treated as evidence.
2. **Frame.** The default `JOINT_AXIS_FREE_V1` strategy generates a joint set
   of roughly six candidate directions. Axes and facets are optional metadata,
   not required for a candidate to be valid. The legacy joint-axis strategy
   remains available for development comparison.
3. **Evaluate.** One separate evaluator call scores every candidate under
   `candidate-rubric-v2`. It receives candidate content, the original prompt,
   and constraints, but not generator self-scores or generation metadata.
4. **Gate and score.** Schema/integrity, evidence, hard constraints, the
   deterministic first-test check, seed leakage, and rubric-floor outcomes are
   retained as candidate-level outcomes. A failed candidate is not eligible
   for selection.
5. **Deduplicate.** Candidate similarity uses embeddings when available:
   cosine similarity of at least `0.92` groups near-duplicates. If embedding
   generation is degraded, normalized token-set Jaccard similarity of at least
   `0.8` is used and the fallback is recorded. The representative is the
   highest-Q candidate, then the lower generation ordinal; candidate ID is a
   stable final tie-break.
6. **Select.** A greedy selector repeatedly chooses the highest current
   quality-minus-redundancy score. It recomputes redundancy after each pick
   and does not fill slots with candidates that failed quality gates.
7. **Persist.** Run policy/schema metadata, full candidate outcomes, rubric
   JSON, generation metadata, hypotheses, and graph changes are persisted.
   Legacy rows remain legacy: nullable v2 columns are not backfilled with
   invented v2 values.

Expansion follows the same schema, evaluation, floor, deduplication, and
selection path, with the operator-specific suitability term described below.
Operator preconditions and effects remain deterministic. Axes may be absent;
planning treats absent axes as unavailable features, and the REFRAME
beneficiary check is skipped when the parent has no axes.

## Schemas and persisted versions

- New initial runs use schema `idea-schema-v2`; historical `stage1-v1` remains
  meaningful for old runs.
- Candidate content includes title, summary, a hypothesis with assumptions,
  supporting fact references, counterevidence and falsifiers, preserved
  intent, changed assumptions, rationale, objection, first test, mechanism,
  and distance. `axes` and `facets` are optional; an `axes` value may be null.
- `candidate-rubric-v2` quality JSON stores each criterion's integer score,
  rationale, and weight, normalized `q`, and `{ passed, failures }` floor
  details. `qualityScore` is the same Q used for ranking.
- Run metadata stores generation strategy and rubric versions. Candidate
  `generation_meta` records the strategy, strategy version, call index, prompt
  version, instruction variant, exact system prompt, and any external
  exploration string or returned seed.
- Existing v1 rubric JSON and policy-version labels remain readable as
  historical data. No historical row is silently converted to the v2 rubric.

The additive migration makes hypothesis axes nullable and adds nullable
generation strategy, rubric version, and candidate generation metadata fields.
Null on old rows means legacy data, not a failed v2 evaluation.

## Candidate rubric v2

Each criterion is evaluated independently with an integer score of `0`, `1`,
or `2` and a short rationale grounded in the candidate:

| Criterion                                                     | Weight | 0                                                                        | 1                                                           | 2                                                                                   |
| ------------------------------------------------------------- | -----: | ------------------------------------------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Intent compatibility and plausibility (`intentCompatibility`) |   0.30 | Contradicts explicit information or has no plausible relationship to it. | Plausible but depends on important hidden assumptions.      | Compatible with explicit information and plausible, with major assumptions exposed. |
| Decision usefulness (`decisionUsefulness`)                    |   0.20 | Offers no worthwhile course of consideration.                            | Interesting but unlikely to affect what the user does.      | Presents an option the user could reasonably consider or test.                      |
| Specificity and coherence (`specificityCoherence`)            |   0.15 | Generic, contradictory, or mechanism-free.                               | Some concrete content, but important gaps remain.           | Clear mechanism and internally coherent reasoning.                                  |
| First-test executability (`firstTestExecutability`)           |   0.20 | Missing, generic, or not practically executable.                         | Executable but too broad, or the success signal is unclear. | Small action with observable success/failure evidence.                              |
| Non-obviousness (`nonObviousness`)                            |   0.15 | Restatement or generic default answer.                                   | Predictable extension or mostly new wording.                | Non-obvious reframing or mechanism that remains relevant.                           |

The normalized ranking heuristic is:

```text
Q(c) = Σ(weight_i × score_i / 2)
```

For example, scores `[2, 1, 2, 1, 0]` yield `0.30 + 0.10 + 0.15 + 0.10 +
0 = 0.65`. Q is not a probability or calibrated quality measurement.

The quality floor records every applicable failure. It rejects any candidate
with:

- A schema/completeness or other deterministic integrity failure.
- An invalid supporting-fact reference.
- A detected hard-constraint violation. Unknown constraint status is not a
  violation; soft-constraint issues do not reject.
- A generic first test under the deterministic first-test check.
- An operator-effect failure during expansion.
- `SEED_LEAK` when an exploration string or returned seed of at least six
  characters appears case-insensitively in candidate content.
- Score `0` on any of the first four rubric criteria (`LOW_SCORE:<criterion>`).
- Non-obviousness score `0` (`RESTATEMENT`).

Exploration strings and returned seeds are stripped from candidate content
before persistence. They remain in generation metadata/attempt metadata only.
Hard gates are independent of Q; a high Q cannot override them.

## Default selection policies

For an eligible, non-duplicate candidate `c` and already selected slate `S`:

```text
R(c, S) = 0                                      when S is empty
R(c, S) = max over s in S of clamp(sim(c, s), 0, 1) otherwise
```

The initial policy is `initial-mmr-v3`:

```text
selectionScore(c | S) = Q(c) − 0.15 × R(c, S)
```

The expansion policy is `expansion-mmr-v2`:

```text
base(c) = 0.70 × Q(c) + 0.30 × operatorSuitability(c)
selectionScore(c | S) = base(c) − 0.15 × R(c, S)
```

The initial slate is capped at four directions and an expansion at three.
Fewer are displayed when fewer candidates pass; an expansion may display none.
The initial run preserves its existing failure behavior if no candidate passes.
Selection is greedy, recomputes R after each pick, and uses no facet-coverage
bonus, axis-coverage bonus, distance quota, or contrarian quota. Ties go to the
lower generation ordinal, then lexicographically smaller candidate ID.
Selection metadata records `q`, expansion suitability when applicable, base,
redundancy, final score, rank, policy version, and the deterministic-policy
note.

Near-deduplication is distinct from the MMR penalty. It preserves the
highest-Q member of a duplicate cluster, then the lower ordinal, then the
lexicographically smaller candidate ID. Embedding cosine `0.92` and degraded
text-fallback Jaccard `0.8` thresholds are unchanged.

### Historical policies

Historical policy names are retained in run metadata and must not be
reinterpreted as the new defaults:

- `initial-mmr-v2` used the legacy v1 label-derived `qualityScore`, plus a
  facet-coverage bonus `0.1 × uncovered/(6 + candidate facet count)`, plus an
  axis-coverage bonus `0.04 × min(2, minimum axis difference)/2`, minus
  `0.15 × maximum similarity to the selected slate`. The bonuses were
  additional to quality; the legacy version did not use the v3 clamped
  quality-minus-redundancy definition.
- `expansion-mmr-v1` used the same legacy quality, facet and axis terms, added
  a suitability bonus `0.05 × operatorSuitability`, and subtracted the legacy
  similarity penalty. Its selection limit was three.
- `candidate-rubric-v1` used labels mapped as low `0`, medium `1`, high `2`,
  with `qualityScore = (0.45 × intentAlignment + 0.35 × usefulness + 0.20 ×
specificity) / 2`. This is a historical score, not a converted v2 Q.

These formulas explain stored historical metadata only. Current runs use the
v2 rubric and v3/v2 selection policies above.

## Generation strategies

The strategy names are versioned and share the same candidate schema,
`candidate-rubric-v2`, deterministic gates, deduplication, and axis-free
selector:

| Strategy                      | Behavior                                                                                                                                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JOINT_AXIS_V1`               | Legacy joint generation with the six-axis contrastive instruction.                                                                                                                                                                                                              |
| `JOINT_AXIS_FREE_V1`          | Joint candidate generation without requiring axes; this is the production default.                                                                                                                                                                                              |
| `INDEPENDENT_SAME_PROMPT_V1`  | Six independent single-candidate calls with the canonical generation instruction.                                                                                                                                                                                               |
| `PARAPHRASE_ENSEMBLE_V1`      | Six single-candidate calls using semantically equivalent instruction variants; the original prompt is passed separately and unchanged.                                                                                                                                          |
| `PARAPHRASE_RANDOM_STRING_V1` | The paraphrase variants with one external exploration string per call. Each string is 16 characters from `[a-z0-9]`; live generation maps 16 `crypto.randomBytes` bytes to that alphabet. With an explicit seed, SHA-256 of `${seed}:${callIndex}` is mapped deterministically. |
| `SSOT_V1`                     | Six single-candidate calls that ask the model to return a seed with one candidate; no private chain-of-thought is requested or exposed.                                                                                                                                         |

| Capability                         | Production behavior                                                                                                   | Development-only behavior                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Initial generation                 | `JOINT_AXIS_FREE_V1` is the default.                                                                                  | The other five strategies are available to tests and the experiment harness.    |
| Candidate evaluation and selection | `candidate-rubric-v2`, the v2 floor, deduplication, `initial-mmr-v3`, and `expansion-mmr-v2`.                         | Same path is shared by all experimental generation arms.                        |
| Provider                           | Mock by default in local/CI configuration; live calls use the configured server-only provider when `MODEL_MODE=live`. | Fetch-mocked tests and reproducible mock experiments.                           |
| Functional equivalence             | Not called and not a candidate hard filter.                                                                           | Pairwise comparison and separate experiment metrics.                            |
| Random strings / SSoT              | Not the core mechanism and not a public strategy selector.                                                            | Controlled strategy arms, with strings/seeds restricted to generation metadata. |
| Experiment harness                 | No endpoint, dashboard, or database writes.                                                                           | CLI writes JSONL and blank-label human-review CSV.                              |

For paraphrase strategies, only the generation instruction is varied. The
canonical source prompt and explicit constraints stay separate and unchanged.
Random perturbations are development experiments, not the core product
mechanism. These arms are not exposed as a production strategy selector. A
single-candidate call gets one repair; a call failing twice fails the run.
Candidate keys are reassigned by the server to `k1` through `k6` by call
index.

## Functional equivalence and development evaluation

The versioned `compare` operation compares two validated candidate contents
against the original prompt and relevant constraints. It returns one of
`equivalent`, `related_but_distinct`, or `distinct`, with a short rationale
about strategic options rather than wording. Output is Zod-validated and gets
one repair. Production generation does not call this operation and does not
use its uncalibrated judgment as a hard filter.

The development experiment harness has no public endpoint, dashboard, or
database writes. It runs six strategies over 20 synthetic prompt fixtures by
default and writes JSONL plus a blank human-review CSV under the gitignored
`apps/server/experiments/out/<timestamp>/` directory. Fixtures are evaluation
inputs, not real user behavior. Mock runs exercise code paths but cannot
establish candidate quality or human judgments.

Metrics are reported separately:

- **Distinct@k:** number of functional-equivalence classes in the selected
  slate.
- **Effective Distinct@k:** number of classes among all generated candidates
  that passed quality gates, before deduplication or selection.
- Pairwise verdict counts and proportions, plus mean and maximum embedding
  similarity within the slate.
- Mean Q over all generated candidates and, separately, the selected slate.

Equivalence classes use union-find over pairs judged `equivalent`. No combined
aligned-novelty score or winning-strategy claim is produced. Pairwise LLM
judgments, embedding similarity, Q, and all other scores are heuristics rather
than human-calibrated measures.

## Live provider and environment

The server-only provider supports OpenAI-compatible chat completions and the
native Anthropic Messages API. OpenAI-compatible structured tasks post to
`{LLM_BASE_URL}/chat/completions`, using strict JSON-schema output when the
task schema can be represented by the provider's strict subset, and otherwise
use `json_object` for that task. Anthropic tasks post to
`{LLM_BASE_URL}/messages` with the same task schema as a tool input schema and
force the task-specific tool choice. The pipeline still performs Zod
validation and the existing single-repair flow; unparseable or text-only
message content is passed through as raw text for that validation path.
OpenAI-compatible embeddings use `{LLM_BASE_URL}/embeddings`. Anthropic has no
embedding endpoint, so its runs deduplicate in degraded word-overlap mode:
normalized token-set Jaccard similarity at `0.8`, recorded as `TEXT_FALLBACK`.
The experiment harness labels slate embedding similarity as unavailable and
records null similarity values for Anthropic. Network/HTTP failures map to
`PROVIDER_ERROR`; aborts map to `TIMEOUT`. Returned usage is attached to
attempt metadata when present. The live path never silently falls back to
mock.

`LLM_API_KEY` is required only when `MODEL_MODE=live`. `MODEL_API_KEY` remains
a deprecated fallback and produces a one-line warning without logging the
value. `LLM_PROVIDER` defaults to `openai`; provider-specific defaults are:

`MODEL_TIMEOUT_MS` is applied separately to each model call, not to the full
generation run. For live runs, consider setting `MODEL_TIMEOUT_MS=180000`
(three minutes).

| Setting               | OpenAI default / use                           | Anthropic default / use                              |
| --------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| `LLM_BASE_URL`        | `https://api.openai.com/v1`                    | `https://api.anthropic.com/v1`                       |
| `LLM_MODEL_STRONG`    | `gpt-4.1` for frame, expansion, and evaluation | `claude-sonnet-4-5` for frame, expansion, evaluation |
| `LLM_MODEL_FAST`      | `gpt-4.1-mini` for extraction and comparison   | `claude-haiku-4-5` for extraction and comparison     |
| `LLM_EMBEDDING_MODEL` | `text-embedding-3-small`                       | Not used                                             |
| `LLM_MAX_TOKENS`      | `4096` (not used by the adapter)               | `16000`                                              |
| `LLM_TEMPERATURE`     | Optional; omitted unless configured            | Optional; omitted unless configured                  |

Mock mode is the default for local tests and CI. Credentials remain on the
server and are not included in request bodies, logs, or development experiment
records. Experiment records include non-secret provider/model settings,
`max_tokens`, and temperature.

## Calibration and limitations

all scores are uncalibrated heuristics until compared with human judgments.
This includes rubric Q, redundancy, operator suitability, functional
equivalence, and experiment summaries. The strategy arms, random-string
perturbations, SSoT, and comparison task have not been established as
improvements. Do not infer product quality or strategy superiority from mock
outputs or synthetic fixtures.
