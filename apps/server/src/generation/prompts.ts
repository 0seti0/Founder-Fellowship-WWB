export const EXTRACT_PROMPT_VERSION = 'extract-v2'
export const FRAME_PROMPT_VERSION = 'frame-v2'
export const EVALUATE_PROMPT_VERSION = 'evaluate-v2'
export const EXPAND_PROMPT_VERSION = 'expand-v1'
export const EXPAND_SCHEMA_VERSION = 'expand-v1'

export const CURRENT_DATE_INSTRUCTION =
  "The input includes currentDate (today's date, weekday and timezone); treat it as the real current date when writing time references such as deadlines, days of the week or 'this month', and never assume a different year."

export const EXTRACT_SYSTEM_PROMPT = `You extract only what a user's prompt explicitly states.

Return JSON matching the provided schema. For every fact and constraint:
- "text" restates one explicitly stated fact or constraint in plain words.
- "evidence" is an exact, contiguous substring copied character-for-character
  from the prompt that states it. Do not paraphrase, join separate fragments,
  fix spelling, or change capitalization inside evidence.
- Do not infer facts about the user from their role, employer, location, or
  wording. Do not add background knowledge.

Constraints:
- strength "hard" only when the prompt explicitly requires or forbids something
  (for example "must", "cannot", "no more than", "by Friday", "only").
- An inferred or stated preference ("ideally", "I'd like", "prefer") is "soft".
- basis is "explicit" when the prompt states the constraint directly, otherwise
  "inferred". A hard constraint must have basis "explicit".

If the prompt states nothing of a kind, return an empty list for it.

${CURRENT_DATE_INSTRUCTION}`

export const FRAME_SYSTEM_PROMPT = `You propose contrastive hypotheses about the deeper goal behind an
underspecified prompt, and one concrete direction for each.

Return about six candidates as JSON matching the provided schema.

Rules:
- Each goal is a hypothesis, not confirmed user intent. State its assumptions
  and falsifiers: observations that would show the hypothesis is wrong.
- Cite supporting facts only by the fact IDs provided. Never invent quotes or
  evidence spans. Add counterevidence when any provided fact cuts against the
  hypothesis.
- You may go beyond what the prompt logically entails, but never violate a hard
  constraint.
- Make the set genuinely contrastive. Vary goal, beneficiary, motivation,
  mechanism, time horizon, and risk; every pair of candidates must differ on at
  least two of these axes. Rewording the same idea is not variation.
- Do not stereotype the user from role, employer, or demographic wording.
- Do not perform generic prompt enhancement (adding polish, scope, or best
  practices that any prompt could receive).
- Do not add random novelty. Every departure from the literal prompt must be
  justified by a stated assumption and a fit rationale.
- Each direction must preserve the prompt's core intent, name the assumptions it
  changes, explain why it might fit, give its strongest objection, and propose a
  first test the user could run this week: a specific action with a concrete
  object and an observable result.

${CURRENT_DATE_INSTRUCTION}`

export const EVALUATE_SYSTEM_PROMPT = `You evaluate candidate directions for a prompt.

Return JSON matching the provided schema, covering every candidate and, for
each candidate, every listed constraint.

Constraint status:
- "satisfied" when the direction clearly respects the constraint.
- "violated" only when the direction clearly contradicts it.
- "unknown" when the direction does not give enough information. Unknown is not
  a violation.

Quality labels (low, medium, high), each with a one-sentence rationale:
- intentAlignment: does the direction stay faithful to the prompt's core intent
  while exploring its stated goal hypothesis?
- usefulness: would pursuing it plausibly help the user make progress?
- specificity: is it concrete enough to act on, including its first test?

Judge the direction on its own content. Do not reward length, polish, or
novelty for its own sake.

${CURRENT_DATE_INSTRUCTION}`

export const EXPAND_SYSTEM_PROMPT = `You transform one selected idea using the
specified unary operator. Return JSON matching the provided expansion schema.
Generate six meaningfully different candidates. Preserve the parent intent,
follow the operator instruction and exclusions, and satisfy its required
effect. Use only supplied supporting fact references. Do not return ids,
status, parent links, or persistence fields. Each first test must be a concrete
action with an observable result.`

// Lead-authored prompt texts. Copy VERBATIM into apps/server/src/generation/prompts.ts.
// Do not reword. Version constants are part of the contract.

export const FRAME_AXIS_FREE_PROMPT_VERSION = 'frame-axis-free-v2'
export const FRAME_SINGLE_PROMPT_VERSION = 'frame-single-v2'
export const FRAME_PARAPHRASE_PROMPT_VERSION = 'frame-paraphrase-v2'
export const FRAME_RANDOM_STRING_PROMPT_VERSION = 'frame-random-string-v2'
export const SSOT_PROMPT_VERSION = 'ssot-v2'
export const EVALUATE_RUBRIC_PROMPT_VERSION = 'evaluate-rubric-v3'
export const FUNCTIONAL_EQUIVALENCE_PROMPT_VERSION = 'functional-equivalence-v2'
export const EXPAND_PROMPT_VERSION_V2 = 'expand-v2'
export const EXPAND_PROMPT_VERSION_V3 = 'expand-v3'

const SHARED_HYPOTHESIS_RULES = `- The goal is a hypothesis, not confirmed user intent. State its assumptions
  and falsifiers: observations that would show the hypothesis is wrong.
- Cite supporting facts only by the fact IDs provided. Never invent quotes or
  evidence spans. Add counterevidence when any provided fact cuts against the
  hypothesis.
- You may go beyond what the prompt logically entails, but never violate a hard
  constraint.
- Do not stereotype the user from role, employer, or demographic wording.
- Do not perform generic prompt enhancement (adding polish, scope, or best
  practices that any prompt could receive).
- Every departure from the literal prompt must be justified by a stated
  assumption and a fit rationale.
- The direction must preserve the prompt's core intent, name the assumptions it
  changes, explain why it might fit, give its strongest objection, name its
  mechanism (how it would actually work), and propose a first test the user
  could run this week: a small action with an observable success or failure
  signal.
- The original prompt is provided separately as input.originalPrompt. Treat it
  as the only source of facts.`

export const FRAME_AXIS_FREE_SYSTEM_PROMPT = `You propose competing hypotheses about the deeper goal behind an
underspecified prompt, and one concrete direction for each.

Return about six candidates as JSON matching the provided schema.

Rules:
${SHARED_HYPOTHESIS_RULES}
- The candidates must be genuinely competing interpretations of what the user
  is trying to achieve, or genuinely different mechanisms for achieving it. Two
  candidates that a reasonable user would see as the same option with different
  wording count as one candidate; replace one of them.
- Do not use a fixed checklist of dimensions to manufacture variety. Choose the
  differences that matter most for this prompt.
- Do not add a candidate only to fill the count. Fewer strong candidates are
  better than a weak or redundant one.

${CURRENT_DATE_INSTRUCTION}`

export const FRAME_SINGLE_SYSTEM_PROMPT = `You propose one hypothesis about the deeper goal behind an
underspecified prompt, and one concrete direction for it.

Return exactly one candidate as JSON matching the provided schema.

Rules:
${SHARED_HYPOTHESIS_RULES}

${CURRENT_DATE_INSTRUCTION}`

// Six semantically equivalent paraphrases of FRAME_SINGLE_SYSTEM_PROMPT's
// opening instruction. The shared rules are appended unchanged to each.
export const FRAME_PARAPHRASE_OPENINGS = [
  `Read the user's underspecified prompt and form one hypothesis about the
deeper goal it may serve. Turn that hypothesis into one concrete direction.`,
  `Suggest a single plausible deeper goal that could lie behind the user's
prompt, then describe one concrete direction that pursues it.`,
  `The user has written a vague prompt. Infer one possible underlying goal,
labelled as a hypothesis, and develop it into one actionable direction.`,
  `Offer one interpretation of what the user may ultimately be trying to
achieve with this prompt, and one concrete course of action that follows from
that interpretation.`,
  `Hypothesize one deeper aim behind the prompt below and express it as a single
concrete direction the user could pursue.`,
  `Identify one candidate deeper goal the prompt might be pointing at, treat it
as an unconfirmed hypothesis, and propose one concrete direction for it.`,
] as const

export function frameParaphraseSystemPrompt(index: number) {
  return `${FRAME_PARAPHRASE_OPENINGS[index]}

Return exactly one candidate as JSON matching the provided schema.

Rules:
${SHARED_HYPOTHESIS_RULES}

${CURRENT_DATE_INSTRUCTION}`
}

export const RANDOM_STRING_ADDENDUM = `
- input.explorationString is an arbitrary random string. You may use it only as
  a private source of arbitrary variation when choosing which hypothesis to
  develop. It carries no meaning about the user. Never copy it, or any part of
  it, into any output field.`

export const SSOT_SYSTEM_PROMPT = `You propose one hypothesis about the deeper goal behind an
underspecified prompt, and one concrete direction for it.

Before choosing, generate a random string of 8 to 16 letters and digits, and
manipulate it (for example by reading characters as indices or choices) to
decide which of the many plausible hypotheses to develop, so that repeated
calls tend to produce different hypotheses. Return the string you generated in
the "seed" field. Do not explain the manipulation and do not include any
reasoning steps in the output; return only the fields in the schema. Never
copy the seed into any other field.

Return exactly one candidate as JSON matching the provided schema.

Rules:
${SHARED_HYPOTHESIS_RULES}

${CURRENT_DATE_INSTRUCTION}`

export const EVALUATE_RUBRIC_SYSTEM_PROMPT = `You evaluate candidate directions for an underspecified prompt.
You did not write these candidates. Judge each candidate independently, on its
own content, against the original prompt and the listed constraints.

Return JSON matching the provided schema, covering every candidate and, for
each candidate, every listed constraint.

Constraint status:
- "satisfied" when the direction clearly respects the constraint.
- "violated" only when the direction clearly contradicts it.
- "unknown" when the direction does not give enough information. Unknown is not
  a violation.

Score each criterion with an integer 0, 1, or 2, and give a one-sentence
rationale that refers to the candidate's actual content.

intentCompatibility (intent compatibility and plausibility):
- 0: Contradicts explicit information or has no plausible relationship to it.
- 1: Plausible but depends on important hidden assumptions.
- 2: Compatible with explicit information and plausible, with major
  assumptions exposed.

decisionUsefulness:
- 0: Offers no worthwhile course of consideration.
- 1: Interesting but unlikely to affect what the user does.
- 2: Presents an option the user could reasonably consider or test.

specificityCoherence (specificity and coherence):
- 0: Generic, contradictory, or mechanism-free.
- 1: Some concrete content, but important gaps remain.
- 2: Clear mechanism and internally coherent reasoning.

firstTestExecutability:
- 0: Missing, generic, or not practically executable.
- 1: Executable but too broad, or the success signal is unclear.
- 2: Small action with observable success/failure evidence.

nonObviousness (relative to the original prompt):
- 0: Restatement or generic default answer.
- 1: Predictable extension or mostly new wording.
- 2: Non-obvious reframing or mechanism that remains relevant.

Do not reward length, polish, or novelty that loses relevance to the prompt.

${CURRENT_DATE_INSTRUCTION}`

export const FUNCTIONAL_EQUIVALENCE_SYSTEM_PROMPT = `You compare two candidate directions proposed for the same
underspecified prompt.

Question: Would a reasonable user experience these as essentially the same
strategic option, despite differences in wording or surface details?

Return JSON matching the provided schema with one verdict:
- "equivalent": the same strategic option; choosing one makes the other
  redundant.
- "related_but_distinct": they share a goal or mechanism, but pursuing one
  would lead the user to meaningfully different actions or decisions.
- "distinct": different strategic options.

Base the verdict on the goal each candidate pursues, its mechanism, and what
the user would actually do, not on shared words. Give a one-sentence rationale
that names the strategic option of each candidate. Respect the listed
constraints as context only; do not judge quality.

${CURRENT_DATE_INSTRUCTION}`

export const EXPAND_SYSTEM_PROMPT_V2 = `You transform one selected idea using the
specified unary operator. Return JSON matching the provided expansion schema.
Generate six meaningfully different candidates. Preserve the parent intent,
follow the operator instruction and exclusions, and satisfy its required
effect. Use only supplied supporting fact references. Do not return ids,
status, parent links, or persistence fields. Facets are optional; omit them
unless they add information. Each first test must be a small action with an
observable success or failure signal.`

export const EXPAND_SYSTEM_PROMPT_V3 = `${EXPAND_SYSTEM_PROMPT_V2}

${CURRENT_DATE_INSTRUCTION}`
