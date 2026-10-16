# ETH-79 evaluation results

## Observed scope

This evaluation uses the integrated ETH-73 through ETH-78 application, PostgreSQL 15, production
Next.js HTTP routes, and the official MCP SDK 1.32.1 over stdio. It does not implement a second app.
Authentication uses the existing loopback-only test identity provider and synthetic sessions.
There are no customer records, paid calls, actual vehicle photographs, or commercial commitments.

The frozen corpus contains 18 original synthetic conversations: eight development cases and ten
held-out cases. Labels were fixed before the first run. These are contract holdouts, not a blind
model benchmark: the same author inspected the bounded recognizer and authored both splits.
Cases share one synthetic opportunity at three evidence stages, so they are not 18 independent
source packets. The corpus SHA256 is
`9017010b5d0c66c41e283a73e82320da4a1edcf5dfdb66967c8ba78a06e72f26`.

The executable corpus is `src/server/evaluation-corpus.json`. The connected runner is
`src/server/evaluation.test.ts`. Normal `npm test` discovers it without another runner.
`EVALUATION_REPORT` optionally writes rows, durations, failures, accounting, and limits.
Assertions remain failures; the report does not turn unavailable trials into passing rows.

## Acceptance matrix

- AE1 passes: both 750 and 500 gallon originals persist; conflict blocks a public answer until
  review. This is saved synthetic extraction, not live extraction accuracy.
- AE2 passes: availability remains a reviewed seller statement, with a seller-reported citation
  label. No service records were attached or verified.
- AE3 actual-photo trial is unavailable. Existing real-stack photo tests pass controlled coverage,
  duplicate, private, and unreadable-image cases. Synthetic pixels prove control behavior, not
  vehicle-view recognition or readability accuracy.
- AE4 passes: explicit $165,000 offer retains pump-test condition, pre-December timing, and an
  unresolved question. Structured terms are never accepted or inferred from hypothetical language.
- AE5 passes: repeated packet preserves reviews and one opportunity; missing adapter records
  NOT_CONFIGURED and can retry. Existing worker tests also kill and restart real child processes.
- AE6 passes: private original, instruction text, and specialist-turn canary stay out of buyer and
  public projections. Identity is controlled locally; hosted authentication is unavailable.
- AE7 passes: report availability is not a result; request stays unsent, controlled report returns
  to its blocker, and review enables cited unsent follow-up. The report and extraction callback
  are synthetic, not an actual pump test.
- AE8 passes: specification, private context, ambiguous inquiry, routing correction, and explicit
  offer remain distinct. Source classifications are saved synthetic output; conversations use HTTP.

The runner checks exact returned classifications, answer values, citation excerpts, review states,
assigned human actions, preserved originals, and unsent drafts. Prop validation is not factual
verification: valid card requests resolve current server evidence. Unknown, conflicting, withdrawn,
or missing references cannot become caller-supplied facts.

Two distinct malformed calls retire only the named tool for that logical turn. Retrying a rejected
call does not count twice. A new turn restores availability, while replaying an accepted call after
evidence withdrawal cannot restore its stale answer. The card schema rejects invented values and
HTML. The suite also compares the complete MCP workbench result with the session HTTP result and
checks current membership, read-only scope, and token revocation through an actual SDK process.

## Metrics and denominators

The recorded run has 27 passing evaluation subtests, including all 18 conversation cases.
Node reports 28 passing tests because it also counts the enclosing test. Development routing is
8/8 and held-out routing is 10/10. This measures the finite recognizer's contract, not general
language understanding, source truth, or sales performance.

- Classification: conflict 1/1; missing evidence 3/3; human review 7/7;
  explicit structured offer 2/2; supported 5/5.
- Unsupported factual answers: zero among 13 non-answer cases. Five answer cases match literal gold
  values and cited excerpts.
- Invented intent or missed human review: 0/7 ambiguous, compound, hypothetical, or injection cases.
- Offer retention: 2/2 structured offers preserve amount, timing text, conditions, unanswered
  questions, and non-acceptance.
- Duplicate saved import: zero additional opportunities or resets in one repeated-packet scenario.
- Live extraction errors: unavailable, zero live packets. Saved or callback output is not an
  extraction-quality sample.
- Actual-photo false coverage or duplicates: unavailable, zero actual vehicle photos. Controlled
  photo regressions are separate.
- Privacy: one connected buyer/public projection scenario and current MCP membership, scope, and
  revocation checks pass. There is no population leak-rate estimate.

Per-row milliseconds in `evaluation.json` include loopback HTTP, PostgreSQL work, response parsing,
and assertions. They exclude application startup, packet setup, browser rendering, human review,
and provider time. Quantiles use nearest rank within each split. Small, correlated local samples
are not a throughput benchmark. Recompute from the report rather than comparing different machines
as a product-speed claim.

One controlled callback reports `controlled-fixture-v1`, 17 input tokens, and 23 output tokens.
Synthetic rates of 2 and 3 microUSD reserve 10366 microUSD and settle 103 microUSD in each budget's
ledger. Both ledgers represent the same charge, not two charges. Reservations and active slots are
zero. These supplied counts and rates test accounting only. They are not provider-measured
usage, prices, or invoices. Paid provider calls: zero. Provider latency and real cost: unavailable.

The full gate separately exercises concurrent admission, uncertain spend after SIGKILL, fresh retry
admission, expired leases, fencing against late completion, current permissions, immutable evidence,
and session-only approval. Passing these controlled tests does not establish provider reliability.
Jev is not implemented, so a Jev versus single-model comparison is unavailable. No conversion,
revenue, human-time saving, or efficiency baseline is claimed.

## Reproduce on a disposable local stack

Follow [development checks](development.md) for the pinned Node 22 toolchain and dependencies.
Use `npm ci`, not a new lockfile. PostgreSQL must accept the operator connection below, and its
database name must end in `_test`. The existing test helper installs all six migrations and a
synthetic `auth.sessions` table under a database lock. It removes its evaluation records afterward.
Never point these commands at a hosted, shared prototype, or production database.

```sh
export PATH="$HOME/.local/share/signal-desk-node/node_modules/node/bin:$PATH"
npm ci
createdb signal_desk_test
npm run build
export TEST_DATABASE_URL='postgres:///signal_desk_test?host=/var/run/postgresql'
CI=true EVALUATION_REPORT=.amp/in/artifacts/evaluation.json \
  node --conditions=react-server --import tsx --test src/server/evaluation.test.ts
```

If the disposable database already exists, omit `createdb`. The focused evaluation starts and stops
its actual production HTTP servers itself. For the full gate, first start a production app for the
separate anonymous HTTP checks. In an orb, use a supervised service rather than a detached shell:

```sh
amp orb service start evaluation-public --command 'npm run start -- --port 3000'
CI=true TEST_APP_URL=http://127.0.0.1:3000 npm run check
```

This loopback URL is for the local runner, not a shareable preview. Other environments can run the
same production app under their process supervisor. Run no tests concurrently against this database
outside the existing database-lock protocol. `EVALUATION_KEEP=synthetic-preview` retains fixture
records only for isolated browser inspection; normal checks must not set it.

To recompute local latency quantiles from a saved report:

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
const report = JSON.parse(readFileSync('.amp/in/artifacts/evaluation.json', 'utf8'));
for (const split of ['dev', 'heldout']) {
  const values = report.rows.filter(row => row.split === split)
    .map(row => row.milliseconds).sort((a, b) => a - b);
  const rank = p => values[Math.ceil(values.length * p) - 1];
  console.log(split, { n: values.length, p50: rank(.5), p95: rank(.95) });
}
JS
```

## Browser observations

Chrome 155 rendered the production app against a separate disposable PostgreSQL fixture with the
existing controlled session provider. Desktop, 390-pixel layout, keyboard submission, native review
controls, saved feedback, stale-card invalidation, and reduced motion were inspected. At 390 pixels,
document scroll width equals viewport width. Source assertions remain labeled 750 versus 500,
review and publication permission remain separate, and a fresh question returns a cited 750-gallon
answer only after review. No-photo state says 0/8 and unavailable vision; it supplies no replacement
images. A real-pointer recording shows keyboard submission and the resulting unknown review state.

The browser-only `.test` origin needed Chrome's isolated secure-origin test flag for
`crypto.randomUUID`. This is not a production fallback. A deployment needs HTTPS. Screenshots and
recordings are supplied in the ETH-79 evidence archive, not substituted for assertions. The browser
fixture is deliberately separate from the scored corpus and does not contribute latency samples.

No broad UI redesign was needed. Raw specialist identifiers remain visually noisy, and the inherited
singular label "1 source assertions" needs a copy pass. Neither prevents the affected workflow.
These observations are not an accessibility certification or a cross-browser test matrix.

## Unavailable trials and deployment prerequisites

No installed live adapter, provider credentials, default budgets, live Supabase instance, or actual
photo provenance exists. None was fabricated or enabled for this evaluation. A future authorized
trial needs a permissioned packet, provenance for each actual image, an isolated auth project,
explicit model policy and budgets, and a real provider adapter. It must report a separate sample
count, citations, extraction errors, unreadable and duplicate views, latency, and billed usage.

Deployment remains unperformed. [Authentication setup](auth-setup.md),
[MCP setup](mcp-setup.md), and [executable contracts](contracts.md) own the prerequisites:
private database and originals,
migrations, invitation and membership provisioning, HTTPS origins and cookies, a durable worker,
operator recovery for uncertain spend, and server-side provider admission. External messages,
payments, offer acceptance, and commercial promises remain disabled.
