# Extraction model evaluation

Chooses the model for the document import worker. Candidates: `anthropic/claude-haiku-5.5`,
`openai/gpt-6-luna` and `deepseek/deepseek-v4.1-flash`, all through OpenRouter on 2026-10-18.

## Recommendation

Use `openai/gpt-6-luna` with reasoning effort `none` and price routing. The catch was that no
model passed the worker's original validation. At effort `none`, 27 of 30 corpus imports were
rejected for model-computed offsets, and only 1 of 339 offsets was exact. Yet 95% of the excerpts
were verbatim and occurred exactly once on the cited page. Model choice could not fix this, so the
worker now derives offsets itself; see [derived locators](#derived-locators-approved-adr-028).

With derived offsets, Luna has the best recall, costs the least, finishes the corpus without
malformed output, accepts PDF and image input, and works through batch.

Tradeoffs against the alternatives:

- DeepSeek has the best derived precision (0.91 against 0.86) and the lowest latency on throughput
  routing (p50 4.0s). But that routing costs 2.5x Luna per document and hit shared upstream rate
  limits. Price routing is slow (23-37s on public documents) and timed out at low effort. Low
  effort spent all 6000 output tokens on 10 of 10 corpus packets. DeepSeek also ignored a
  directly attached PDF.
- Haiku is the most conservative. It had the lowest recall (0.58), and 5 of 12 corpus and public
  runs failed the schema because it returned zero-width offsets rather than guess. At default
  effort it spent its whole output budget on reasoning.

## Method

- The adapter is [`openrouter.ts`](../apps/web/src/server/openrouter.ts), and every call passed
  through `runInference` admission. It uses strict JSON-schema structured output with no provider
  fallback, and cost comes from the provider-reported `usage.cost`.
- The harness is [`extraction-eval.ts`](../apps/web/src/extraction-eval.ts). It runs the
  production import worker against a disposable local PostgreSQL database (`*_eval_test`) and
  scores both the raw model output and what the worker committed.
- Labels were frozen in git before the first model run on each set:
  - ETH-79 saved packet: 4 files, 3 claims, 750 against 500 gallon conflict.
  - Synthetic corpus: 18 documents in 5 packets with 56 gold claims, in
    [`corpus.json`](../apps/web/src/server/extraction-corpus/corpus.json).
    - Includes text PDFs, an image-only scan, a purchase agreement, cross-document conflicts,
      noise and a prompt-injection document with canaries.
  - Public documents: 3 manufacturer brochures and Army manual pages, in
    [`public-documents.json`](../apps/web/src/server/extraction-corpus/public-documents.json).
- Value scores count canonical facts per document. "Derived" scores the claims a worker would keep
  if it located each verbatim excerpt itself and dropped invalid claims individually.

## Results at reasoning effort `none`

Synthetic corpus, 2 runs per model (10 packet imports):

| Metric                         | Haiku 5.5 | GPT-6 Luna | DeepSeek V4.1 Flash |
| ------------------------------ | --------- | ---------- | ------------------- |
| Imports accepted by worker     | 0/10      | 0/10       | 0/10                |
| Value precision / recall (raw) | 0.66/0.62 | 0.70/0.79  | 0.71/0.74           |
| Value precision / recall (der) | 0.88/0.58 | 0.86/0.79  | 0.91/0.70           |
| Field precision / recall       | 0.92/0.83 | 0.94/0.98  | 0.95/0.96           |
| Exact model offsets            | 0/101     | 0/123      | 1/115               |
| Excerpt verbatim and unique    | 93/101    | 122/123    | 109/115             |
| Conflicts preserved (raw)      | 4/8       | 4/8        | 4/8                 |
| Injection canaries or facts    | 0         | 0          | 0                   |
| Malformed output               | 3/10      | 0/10       | 0/10                |
| Latency p50 / max (s)          | 6.3/9.0   | 8.0/9.5    | 4.0/5.8 (thru.)     |
| Cost per document (USD)        | 0.00031   | 0.00022    | 0.00054 (thru.)     |

ETH-79, 3 runs each:

- Luna recalled 9 of 9 values with no false positives.
- DeepSeek recalled 7 of 9 with 1 false positive.
- Haiku recalled 5 of 9 with none.
- All three kept the conflict in raw output, but none committed it because of offsets.

Public documents (1 run each):

- Luna had derived precision 0.67 at recall 0.50.
- DeepSeek on price routing had 0.75 at 0.50.
- Haiku had 0.50 at 0.42 and failed the schema on both packets.

Field recall was 0.83-1.0; the misses were mostly value formatting and offsets.

Worker rejections by cause, across the 30 imports above:

- Offsets: 27.
- Value format: 21, for example `48,210` miles, `2,839 L (750 gal)`, `about 85k` or a pump-test
  sentence given a `gpm` unit.
- Schema: 3, all Haiku zero-width offsets.
- Incomplete classifications: 1.

## Higher effort

- At default effort, Haiku exhausted 6000 output tokens on reasoning, and Luna took p50 46s.
- At low effort, there were 0 accepted imports from 30, with p50 latency of 15-21s.
- At low effort, DeepSeek returned `length` with 6000 output tokens on 10 of 10 packets.
- Low effort raised Haiku's exact offsets to 29 of 38, but half its runs exhausted output and the
  rest failed value format. Luna managed 20 of 78.
- Reasoning buys some offset accuracy at 2-3x latency without producing an accepted import, so
  derived offsets are the better fix.

## Input modes

| Probe (gold values recalled)           | Haiku          | Luna      | DeepSeek               |
| -------------------------------------- | -------------- | --------- | ---------------------- |
| Synthetic scanned page as image        | 3/4            | 3/4       | 3/4 (price routing)    |
| Purchase agreement as direct PDF file  | 4/6            | 4/6       | ignored file, 0 claims |
| Sierra brochure, 2 page images, no OCR | 0/3, abstained | 2/3       | 1/3, value format      |
| ETH-79 via `:batch`                    | 3/3, 520s      | 3/3, 401s | 3/3, 449s              |

Haiku and Luna accept PDF file input directly. DeepSeek accepts images only.

Batch works for all three models. OpenRouter routed the batches to Anthropic, OpenAI and Sail
Research, and each settled through `reconcileInference` from its batch receipt. Turnaround of 7-9
minutes cannot fit the worker's 60-second lease. Batch images must be URLs, not data URLs, so
seller documents would need signed, expiring URLs. Batch suits backfills, not interactive imports.

## Spend

The ledger totals $0.415 against a $0.90 harness cap and the $1.00 limit:

- $0.231 is provider-reported receipts.
- $0.184 carries 7 early calls whose outcome was not recorded (timeouts and two crashed runs), at
  their worst-case price.

The shared key's usage grew by $0.447 during the work, which includes spend from other users of
that key.

Integer micro-USD admission rates overstate these prices 2-15x, because 1 µ$ per token is the
minimum rate. This matters for budget sizing, not for safety.

## Derived locators (approved, ADR-028)

The worker now derives offsets from a verbatim excerpt that occurs exactly once on its cited page,
drops unverifiable claims individually, and counts them on the job. Luna at effort `none`, rerun
through the changed worker:

| Set                      | Accepted | Committed precision / recall | Conflicts |
| ------------------------ | -------- | ---------------------------- | --------- |
| ETH-79, 3 runs           | 2/3      | 1.00 / 1.00 when accepted    | 2/3       |
| Synthetic corpus, 2 runs | 9/10     | 0.92 / 0.86 (89/8/15)        | 7/8       |
| Public documents, 1 run  | 2/2      | 0.75 / 0.50                  | n/a       |

Before the change, every one of these imports was rejected. Both remaining rejections were a
single mistyped character in a source UUID (`4f7d` for `4f5d`), which fails the classification
envelope. Giving sources short aliases such as `S1` in the frozen input, mapped back by the
worker, would remove that failure mode without loosening validation.

### Short source aliases

Both remaining rejections were a single mistyped character in a source UUID (`4f7d` for `4f5d`).
The worker now shows each source to the provider as `S1`, `S2` and maps citations back to the
real IDs. Luna at effort `none`, rerun through that worker:

| Set                      | Accepted | Committed precision / recall | Conflicts |
| ------------------------ | -------- | ---------------------------- | --------- |
| ETH-79, 3 runs           | 3/3      | 1.00 / 1.00 (9/0/0)          | 3/3       |
| Synthetic corpus, 2 runs | 10/10    | 0.90 / 0.90 (94/10/10)       | 7/8       |
| Public documents, 1 run  | 2/2      | 0.75 / 0.75 (9/3/3)          | n/a       |

Corpus latency p50 was about 6s, and the 15 imports cost $0.0063 in provider-reported usage. The
ledger after all reruns is $0.431.

## Original proposal

The worker should keep validation strict but stop asking the model for character offsets:

1. Derive `start` and `end` from the claim's excerpt when it occurs exactly once on the cited
   page. Reject the claim when the excerpt is absent or ambiguous.
2. Reject invalid claims individually and commit the rest for human review, rather than failing
   the whole import with a terminal `INVALID_EXTRACTION`.
3. Accept thousands separators in numeric values (`48,210`), and ask for bare numbers in the
   schema description. Keep hedged values such as `about 85k` rejected.

Provenance stays exact because offsets still point to verified text on a stored page, and human
review is unchanged. All three parts were approved and implemented.

## Reproducing

```sh
npm run eval:extraction -w @signal-desk/web -- --suite corpus --effort none \
  --models anthropic/claude-haiku-5.5,openai/gpt-6-luna
npm run eval:extraction -w @signal-desk/web -- --suite rescore
npm run eval:extraction -w @signal-desk/web -- --suite summary
```

Suites: `eth79`, `corpus`, `public`, `scanned`, `pdf`, `public-image`, `batch`,
`batch-settle`, `rescore` and `summary`. `EVAL_DATABASE_URL` must name a local database ending in
`_test`, and rows go to `.amp/in/artifacts/extraction-eval/`.
