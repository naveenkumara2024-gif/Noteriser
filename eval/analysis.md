### In one paragraph

On 72 planted-error drafts (36 dev, 36 test) the verifier let **no bad draft through as SUPPORTED** when a live judge was used, and it removed or flagged every one of them. But it also flags about one in three **good** drafts (24 of 72 across both splits, with the live judge), and removes 8 of 72 good drafts outright. The first number meets the lore's recall target; the second **misses the over-flag target of 15% by a wide margin**. The over-flagging is not something the thresholds can fix: a sweep over 4,144 threshold settings on the dev split found none that reached 15%, and the best one differed from today's by a single draft.

### What it catches

- **Everything planted, once the other checks are in play.** Invented statistics, altered numbers, outside facts, reversed meanings, dropped negations, over-generalisation and fake quotes were each caught in 100% of the cases on both splits. The deterministic checks do much of this: a number the notes never state, a quote that is not in the cited sentence, or a word like "always" that the notes do not use is caught without any model.
- **Citations are always real.** Every draft the verifier let through had a quote that exists in the cited sentence (citation validity 100%).
- **Known past mistakes stay fixed.** The six regression cases (one-word quotes, spliced quotes, formula and initialism false alarms, the lore's four bad drafts) are all handled correctly today.

### What it misses

- **Scope shifts, if the second reviewer is not working.** With a neutral (always-pass) judge, 6 of the 9 scope-shift drafts were passed as SUPPORTED, for example "Memory cells allow the body to respond faster to any new pathogen" (the notes say *if the same pathogen returns*) and "Page faults occur whenever a process accesses memory" (the notes say *a page that is not in physical memory*). The entailment model agrees with these because they sound close to the source. Only the judge caught them, and it did: every scope shift was caught with the live judge. So scope shifts depend on the judge being available and good. When the judge fails, the verifier already treats the item as unverified (it can never be SUPPORTED), which is the safe behaviour, but it means the judge is a single point of reliance for this failure type.
- **Errors I did not think to plant.** These drafts were written to contain one clear error each. Real model mistakes are often subtler, and a verifier's score on planted errors is an upper bound on its score on real ones. The human-reviewed pipeline evaluation that would measure this has not been run (it needs two reviewers).
- **Question drafts** (multiple-choice distractors, answer keys) are not in this case set; they are covered by unit tests, not measured here.

### Where it over-flags

Good drafts were wrongly flagged for four separate reasons, and fixing any one of them leaves at least 10 of the 36 dev drafts flagged:

1. **The second reviewer is strict.** The free model used as judge said "fail" on 10 of 72 good drafts (about 14%), usually faithful paraphrases that leave out a detail the source mentions.
2. **The word list for strengthening words** ("always", "every", "never", "widely", "mostly") flags a faithful paraphrase when it uses a different quantifier than the notes: "never created or destroyed" for "cannot be created or destroyed", "every step" for "each step", "mostly" for "most".
3. **The unseen-word count.** Three or more ordinary words that the notes never use push a draft to PARTIAL; a good paraphrase often swaps a few verbs.
4. **The entailment model is brittle.** It scored a correct, negated paraphrase ("a reply that changes the terms is *not* an acceptance but a counter-offer") as a contradiction, and gave 0.01 to a good "every new molecule keeps one of the original strands".

The most damaging case is a fifth, smaller one: **five good drafts (two dev, three test) were rejected outright as CONTRADICTED**, which means removed and never repaired. In four of them the claim combines two cited sentences, and the entailment model's views disagreed: one view entailed it at 0.99 and another contradicted it at 0.99. A correct two-fact claim should not be deleted because one sentence on its own does not state both facts.

### What would help (proposals, not changes)

These are suggestions for Stage 3 and 4 work. None has been applied, and none was tuned on the test split.

1. **Take contradiction only from the view that contains every cited sentence** (and keep taking the best entailment from any view). This targets the five outright deletions without weakening the check for single-sentence claims.
2. **Compare strengthening words by family, not by spelling**: never/cannot/not, every/each/all, most/mostly. Flag a quantifier only if the notes' own quantifier is weaker.
3. **Count unseen words as a share of the claim's content words, with a larger allowance for common verbs**, instead of a flat count of three. The threshold sweep shows the count alone cannot be tuned out of the problem.
4. **Evaluate a stronger or second judge.** The false-reject rate above belongs to one free model. A comparison with a larger judge was planned but could not be run, because the provider's free daily limit had already been used up. A second opinion only when the first says "fail" would also cost little.
5. **Do not switch to the smaller entailment model.** On the dev split it caught about the same (94% against 92%) and over-flagged more (33% against 28%).
6. **Remember what over-flagging means in the app.** A PARTIAL item is shown with a "check against source" flag, and the repair step already rewrites failing items once (9 of 11 improved in the live run on the sample lecture); only UNSUPPORTED and CONTRADICTED items disappear into the Removed panel. The user-visible cost of a 28-39% raw over-flag rate is smaller than it sounds, but it is real, and the Removed panel exists so nothing vanishes silently.

### Limits of this evaluation

- One author wrote the notes, the drafts and the labels, so the labels are not independently checked and the "test" split is not independent in authorship.
- 36 good and 36 bad drafts per split: a difference of one or two drafts is noise (see the intervals above).
- The live judge is a free model and answers can vary from run to run; each configuration was run once.
- The OpenRouter judge comparison was not run (free daily quota exhausted).
- Threshold tuning was done on the dev split only; the recommendation (keep) was written before the test split was run, and the test split was run once per configuration.
