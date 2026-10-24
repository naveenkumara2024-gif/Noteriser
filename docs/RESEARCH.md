# Research notes — what existing tools teach NoteBridge

Gathered 2026-10-24. "Verified" = read from a primary source (npm registry, Hugging Face config, official docs
page text) in this session. "Reported" = secondary source (blog/review/vendor), treat as anecdotal.

## 1. Existing applications of this kind

| Tool | What it does | Lesson for NoteBridge |
|---|---|---|
| **Google NotebookLM** | Answers and study guides from uploaded sources; numbered citation per sentence, click opens the Sources panel with the passage highlighted (reported) | Copy the interaction: citation → highlighted source sentence. Differentiate on what it lacks: an *independent* verifier, visible removed items, measured error rates |
| NotebookLM limits | Citations do not guarantee correctness; it can omit exceptions or misstate details; flashcards have only "got it / missed it" and no spaced repetition; one blog test reported ~13% response-level hallucination (single test, unverified) (all reported) | "A citation exists" ≠ "the citation supports it" → we verify entailment, not just citation presence. Offer Anki TSV export to cover the spaced-repetition gap cheaply |
| **Quizlet Magic Notes**, Anki + AI add-ons | Flashcards/quizzes from notes; adaptive modes behind paid tier (reported) | Output formats students already use; keep export simple (Markdown, TXT, TSV) |
| **Anthropic Citations API** | Plain-text documents are chunked into sentences; the model cites sentences; `cited_text` is returned, pointers to the document are guaranteed valid (verified, official docs) | Same sentence-ID idea we use, but provider-locked. We keep our own provider-neutral IDs + verbatim-quote check so generator and judge can be different vendors via pi-ai |
| **Vectara HHEM / leaderboard**, **MiniCheck**, **AlignScore** | Small trained models that score whether a claim is supported by a document (verified from search results; numbers vendor-reported) | Our NLI check is the same family. Best practice to copy: split long context into chunks and the claim into sentences, aggregate (AlignScore); decompose compound claims (MiniCheck) |
| **LLM-AggreFact / SummaC** | Benchmarks for factual-consistency detectors; thresholds tuned on a validation split, reported as balanced accuracy | Stage 8: tune thresholds on a **dev** split, report on a held-out **test** split, report balanced accuracy + recall + over-flag |
| "Verify with Caution" (arXiv 2501.14883) | Imperfect factuality metrics mislead when used as ground truth | Never trust one score; four independent checks; publish verifier error rates |

## 2. Stack decisions and the evidence

| Decision | Evidence |
|---|---|
| Use `@earendil-works/pi-ai`, not `@mariozechner/pi-ai` | npm registry: old package v0.73.1 carries `deprecated: "please use @earendil-works/pi-ai instead"`; new package v1.4.0 (modified 2026-10-21), Node ≥ 22.19, depends on official OpenAI/Anthropic/Google SDKs + TypeBox |
| Structured output via forced tool + TypeBox | pi-ai README: no JSON-mode API; tools use TypeBox schemas, `validateToolCall` validates args, `agentLoop` retries on validation errors |
| Providers and abort | README: 25+ providers incl. Anthropic, OpenAI, Google, Mistral, Groq, OpenRouter, Bedrock, and any OpenAI-compatible endpoint (Ollama, vLLM, LM Studio); `signal` for abort; `usage.cost.total` per message |
| NLI in TypeScript | Hugging Face `Xenova/nli-deberta-v3-small`: `id2label` = {0: contradiction, 1: entailment, 2: neutral}, max 512 positions, ONNX int8 ≈ 161 MB (xsmall int8 ≈ 90 MB as a lighter fallback) |
| Not Bespoke-MiniCheck-7B | Strongest reported detector (77.4% LLM-AggreFact, vendor-reported) but 7B parameters and **CC BY-NC 4.0** |
| `node:sqlite`, no ORM | Smoke-tested on this machine (Node 24.13): works, ExperimentalWarning only. Avoids `better-sqlite3` native build on Windows |
| npm, not pnpm | `pnpm` not installed on the dev machine; npm 11.17 present |

## 3. Accessibility facts used

- WCAG 2.2 SC 1.4.12 Text Spacing (AA): content must survive user overrides of line-height 1.5×, paragraph spacing 2×, letter-spacing 0.12em, word-spacing 0.16em with no loss of content or function. Fixed heights and `nowrap` labels are the usual failures → Stage 6 tests exactly these overrides.
- WCAG does not mandate a "dyslexia font". Spacing, contrast, structure and consistency matter. A readable-font option is offered but **no efficacy claim is made**.
- Not verified: `SpeechSynthesis` word-`boundary` event reliability across browsers/voices. Stage 6 tests it in a real browser and falls back to item-level highlighting.

## 4. Open facts to confirm during build (do not assume)

1. pi-ai: exact `Context` shape, whether a tool choice can be forced, how `temperature` is passed, how a model id string maps to `getModel(provider, id)`.
2. Transformers.js v4: whether `text-classification` accepts `{ text, text_pair }`; otherwise tokenizer + `AutoModelForSequenceClassification` + softmax.
3. TypeScript 7 compatibility with Next 16.4, Biome 2.6, Vitest 5.
4. Whether small DeBERTa NLI separates abstractive two-sentence compressions well; if not, that is a Stage 8 finding, not something to hide.

## Sources

- [pi-ai README (jsDelivr, @earendil-works/pi-ai 0.79.1)](https://cdn.jsdelivr.net/npm/@earendil-works/pi-ai@0.79.1/README.md)
- [npm registry: @mariozechner/pi-ai](https://registry.npmjs.org/@mariozechner%2Fpi-ai) · [@earendil-works/pi-ai](https://registry.npmjs.org/@earendil-works%2Fpi-ai)
- [Anthropic Citations docs](https://platform.claude.com/docs/en/build-with-claude/citations)
- [Xenova/nli-deberta-v3-small config](https://huggingface.co/Xenova/nli-deberta-v3-small/resolve/main/config.json)
- [MiniCheck paper](https://arxiv.org/pdf/2404.10774) · [AlignScore paper](https://arxiv.org/pdf/2305.16739) · [Verify with Caution](https://arxiv.org/pdf/2501.14883)
- [Bespoke-MiniCheck](https://bespokelabs.ai/bespoke-minicheck) · [LLM-AggreFact](https://www.alphaxiv.org/benchmarks/the-university-of-texas-at-austin/llm-aggrefact)
- [NotebookLM and hallucination (St. Hakky)](https://book.st-hakky.com/en/service/how-to-use-notebooklm-and-information-about-hallucination) · [source grounding explained](https://peekaboolabs.ai/blog/source-grounding-meaning-explained-how-notebooklm-answers-and-where-it-falls-short-2026-185476)
- [Best AI flashcard makers compared (Save My Exams)](https://www.savemyexams.com/learning-hub/useful-resources/best-ai-flashcard-generator/) · [NotebookLM flashcard limits](https://www.notelyn.com/blog/notebooklm-flashcards-suck)
- [WCAG 1.4.12 Text Spacing](https://www.pearson.com/accessibility-guidelines/perceivable-principle/text-spacing.html)
