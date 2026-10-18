# OpenNext on Cloudflare Workers spike

Measured on 2026-10-18 on branch `spike/opennext`, against the spike Supabase project and staging
Workers only. Model spend for the spike was about US$0.05 of the US$0.25 limit.

## Recommendation

- **No-go on Workers Free.** The 10 ms CPU limit per request is the blocker, not bundle size.
- **Go on Workers Paid (US$5/month), keeping Next.js through `@opennextjs/cloudflare`.**
  Everything worked functionally in workerd, and Paid allows 30 s CPU per request.
- **Don't switch to React Router to stay on Free.** It would not fit either: authenticated SSR and
  the SSE observation loop exceed 10 ms CPU in any framework. Hosting on Free would mean moving
  the SSE observation into the Durable Object owner and keeping pages trivial. That is unmeasured.
- Run the website and the streaming owner as **two Workers** that share one Hyperdrive config.
- Imports run as a **Queue consumer** on the owner Worker. PDF text comes from `unpdf`, which
  matched `pdftotext` on every gold excerpt.

## 1. Does Next 16 run on Workers?

Next 16.4.1 builds with `opennextjs-cloudflare build` (OpenNext 1.20.12). Three changes were
needed:

- `outputFileTracingIncludes` for `pg-cloudflare`, which `pg` loads only under the `workerd`
  export condition.
- `instrumentation.ts` installs a Hyperdrive pool owned by each request's `ctx`.
- Database state moved to `globalThis`, because Next bundles instrumentation and routes as
  separate module copies.

| Check                     | Local workerd       | Staging Worker on Free          |
| ------------------------- | ------------------- | ------------------------------- |
| `proxy.ts` sign-in        | Works               | Works, 871 ms; often over CPU   |
| API routes (401 JSON)     | Works               | Works, under CPU                |
| Austin workspace, Sale    | Matches the design  | `/desk` pages exceed 10 ms CPU  |
| Full specialist turn      | Done in 12 s        | Done in 18 s via the owner      |
| SSE observation           | Streams to the end  | Killed: 961 ms CPU in 7.8 s     |
| Cancel                    | `cancelled`         | Unreachable after the SSE kill  |

There are no server actions in the app. The visible `show_card: {...}` text in some replies is
existing model behavior (Kimi writes the tool call as prose) and also happens on Node.

## 2. Bundle size

| Worker               | Gzipped   | Free 3 MiB limit | Paid 10 MiB limit |
| -------------------- | --------- | ---------------- | ----------------- |
| Website (OpenNext)   | 3,034 KiB | 38 KiB headroom  | Fits              |
| Streaming owner      | 1,302 KiB | Fits             | Fits              |
| Both in one Worker   | ~4.3 MiB  | Does not fit     | Fits              |

The raw website upload is 14.8 MB. The website would barely fit Free on size alone, so a few
dependencies would push it over.

## 3. PDF extraction with `unpdf`

`unpdf` 1.9.0 (PDF.js) replaces the `pdftotext` executable, so imports need no OS binary.
`npm run compare:pdf -w @signal-desk/web` compares the two:

- Every labeled corpus and public PDF has identical page counts. All 49 gold excerpts still occur
  exactly once on their cited page, which is what derived locators (ADR-028) need.
- Scanned and image PDFs give no text under both, so they fail as `NO_TEXT` either way.
- The full seller fixtures:
  - HME: 2/2 pages, with 1 character of reading-order difference.
  - Sierra: no text layer under either extractor.
  - TM manual: 778/778 pages with identical text, 1.35 s against 0.48 s. It is now rejected as
    `TOO_LARGE` from the page count in 129 ms, before any text is extracted.
- ETH-79 is a text packet, so the extractor does not touch it.

Live imports through `unpdf` (GPT-6 Luna, effort `none`, 1 run, US$0.004):

| Set               | Accepted | Committed precision / recall | ADR-028 baseline |
| ----------------- | -------- | ---------------------------- | ---------------- |
| ETH-79            | 1/1      | 1.00 / 1.00                  | 1.00 / 1.00      |
| Synthetic corpus  | 5/5      | 0.85 / 0.88 (46/8/6)         | 0.90 / 0.90      |
| Public documents  | 2/2      | 0.82 / 0.75 (9/2/3)          | 0.75 / 0.75      |

Acceptance holds. The quality differences are within single-run noise.

**Where imports run:** a Queue consumer on the owner Worker. The upload request enqueues the job
ID, and the consumer runs the existing `claimImport(id)` and `processImport`. The Postgres lease
stays the source of truth, so a redelivered message is harmless. A cron sweep re-enqueues jobs
whose lease expired. A Durable Object adds nothing here, because jobs share no state.

PDF parsing stays in the upload request. With the page count checked first it costs at most about
1 s of CPU, well inside the Paid limit of 30 s. Moving it into the consumer would need a pending
state for every source, because imports freeze source text when they are queued.

## 4. One Worker or two?

Use two Workers, with both bound to the same Hyperdrive config:

- Together they need about 4.3 MiB, which needs Paid even before CPU is considered.
- The owner holds the Durable Objects, the cron sweep and the Queue consumer. The OpenNext entry is
  generated, so adding those to it needs a custom wrapper.
- Separate deploys keep website releases from interrupting in-flight turns.
- The website should reach the owner through a service binding instead of the public URL and
  token.

## Follow-up (ADR-031)

The recommendation is built: the website Worker calls the owner through the `StreamOwner` service
binding, and imports run on the owner's Queue consumer. `npm run test:cloudflare` checks the
consumer on workerd, including a repeated wake and recovery by the cron sweep. Both Workers were
also run together locally against the spike project, where sign-in, a full turn, cancellation, a
PDF upload through `unpdf` and a queued import all worked.

- On current main the website is 3,609 KiB gzipped and the owner 1,308 KiB. The website no
  longer fits Free's 3 MiB even alone; Paid allows 10 MiB.
- Nothing touches `garage-prototype` or production. Deploying waits for Workers Paid.
- The staging Workers `signal-desk-web-staging` and `signal-desk-streaming-staging` stay in place.
