# Signal Desk behind the scenes

## The Story So Far

The first implementation unit builds the locked doors before the evidence workbench. The real
Next.js app runs without credentials, but it tells the truth about the missing sign-in service.
It never swaps in a pretend user to make the demo look finished.

The evidence workbench now keeps the original takes and the approved edit separately. A 750-gallon
brochure and a 500-gallon seller note remain two claims until a specialist resolves them. Reloading,
reimporting, or restarting the worker cannot erase that specialist's correction.

The photo desk follows the same rule: a supplied image is the original take, a machine label is a
proposed slate, and the specialist's review is a separate edit decision. Eight readable view types
make a coverage checklist, not a mechanical inspection. Unknown and blurry shots leave gaps.

## Cast & Crew (Architecture)

Supabase Auth checks the person's identity at the studio entrance. PostgreSQL keeps the current
call sheet. Being on the lot does not authorize someone to enter every set or charge the production.

`src/server/auth.ts` verifies the Supabase session. `src/server/access.ts` reads current invitation,
role, spending permission, and record membership. `src/server/records.ts` selects the facts and
source bytes that those permissions allow. Next.js routes return those permitted results.

`evidence.ts` is the review desk: it preserves sources and appends human decisions. `imports.ts`
freezes an authorized packet before the worker extracts claims. `model.ts` still owns every paid
attempt. The public record is the delivery cut, not a download of the entire source bin.

`photos.ts` reads authorized photo originals and appends human reviews in that same transaction.
`photo-schema.ts` calculates coverage and pure request suggestions. Existing jobs carry actual
photo bytes through `runInference`; they do not get a second entrance around the spending gate.
The follow-up workflow owns saved drafts. The photo desk only proposes unsent content and links
back to the existing blockers and evidence.

## Behind the Scenes (Decisions)

We do not trust a role in user-editable metadata. The application stores its own role and access
revocation timestamp in a private schema. Even a previously valid actor is checked again when it
opens a record or requests spending permission.

The approved public record is a separate export, like a final delivery cut. It does not serialize
the entire editing project and hope that nobody notices the private tracks. Each fact needs both
review approval and permission to share. Private documents are never public downloads. Photos have
a separate public-media route that checks their latest explicit approval before serving bytes.

Access helpers accept the current PostgreSQL transaction client. The next unit can check access
and reserve a budget through one connection rather than accidentally reading a different snapshot.
That unit still owns its locks and budget accounting.

The inference boundary now reserves money before each numbered provider attempt, like approving a
purchase order before a shoot. PostgreSQL reserves against both the person's allowance and the
production's total allowance together. Two browser tabs cannot each spend the same last dollar.

Permission locks last only through admission. Provider calls run after the transaction commits,
without occupying a database connection. A revocation that commits first stops admission. Once
an attempt is authorized, revocation cannot recall it. Revoked access cannot retrieve its result.

Every claim has an exact page and character range. A correction changes the reviewed answer, not
the original quote. Reviews remember which claims existed when the specialist approved them.
When a new conflicting claim arrives, that old approval no longer silently counts as current.

Seller responses return to their originating blocker, like a pickup shot returning to its scene.
A reviewed seller assertion stays labeled seller-reported. It does not become a document-backed
safety guarantee just because a person checked its wording.

Photo coverage deliberately requires human review. A model suggesting "driver side" does not mean
the evidence has been inspected. If two uploads contain the same image, the newest human decision
wins and the image counts once. Otherwise one repeated take could falsely fill both side views.
Private photos never complete the shared checklist, and public coverage uses only approved photos.

## Bloopers (Bugs & Fixes)

An unquoted shell glob can expand before Node sees it and miss deeply nested tests. The npm test
command quotes `src/**/*.test.ts`, so Node 22 performs recursive discovery itself.

Fallow did not automatically recognize those native test roots. A small plugin now declares the
same glob to its analysis graph. That fixes its test-reachability estimate, not runtime coverage.
The shared quality gate still executes PostgreSQL and HTTP checks separately.

A signed access token can survive logout. The application checks its session ID against the live
`auth.sessions` table as well as verifying identity. A removed or expired session cannot pass that
second check. Local PostgreSQL tests exercise this rule; hosted sign-in remains unverified until
the isolated prototype project is configured.

A lost provider response is not proof of a free call. Killing the actual test worker after dispatch
leaves a durable reservation and occupied concurrency slot. Only a verified provider receipt or
confirmed non-billing releases that uncertainty. Recovery needs an operator connection.

A retry has its own attempt number. Repeating attempt 1 returns its stored outcome rather than
quietly turning a repeated network request into another bill. Attempt 2 needs fresh permission,
available money, and the configured cooldown. Billed failures retain their usage separately.

Private classification text could have leaked through a shared next-action field even when the
source itself was hidden. Routing now uses sales-audience sources only. Private classification
history stays with its source. The test assigns a second specialist and checks the entire returned
workbench for the private text, not merely whether the source list hides a row.

Job deduplication deliberately ignores a renamed file. A recovery test reused an earlier original
and therefore received an already-completed job. Giving the fixture distinct bytes tested an actual
killed worker instead of accidentally testing a duplicate upload.

An unreadable odometer does not become readable merely because a worker labels it correctly.
The regression test gives the worker a conflicting passenger-side suggestion after a specialist
marks the original odometer unreadable. Both decisions remain visible, coverage stays incomplete,
and the suggested request still asks for a readable replacement. A missing live adapter produces
an unavailable job, not invented image analysis.

## Director's Commentary

Model the domain changed the data design. Invitations, buyer ownership, specialist membership, and
public publication are separate records instead of one role flag that grants everything.

Type system discipline changed the boundaries. Runtime schemas validate database projections and
verified claims before application code uses them. Private source bytes require a permitted query,
not merely a hidden navigation link.

Test the failures that would ruin the demo. Our asymmetric fixture has two buyers, one specialist,
one assigned opportunity, one private source, one sales source, and an approved-but-unshareable
fact. A correct happy path alone would not detect those disclosure mistakes.

Foundational Thinking changed the inference design. The database stores operations and numbered
attempts separately, so request identity survives retries while each potential charge has its own
record. A database constraint separates unfinished attempts from settled reports.

The PostgreSQL race test starts twelve contenders for one remaining reservation. It asserts one
provider dispatch and eleven budget denials. Controlled providers are deliberately below the real
reservation path. They prove admission and recovery, not live model quality or provider pricing.

A worker lease and a purchase order answer different questions. The lease says which worker may
commit. The reservation says whether a provider might still bill. Expiring the first never clears
the second. A real SIGKILL test verifies that distinction, and a second test lets an old worker
finish after losing its lease to prove that its result cannot overwrite the recovered job.

The UI uses native disclosure controls and explicit review states. Conflicts appear before unknown
fields so the consequential decision is visible without searching through an empty specification
sheet. Publication still requires separate approval and permission to share the cited excerpt.

Build the Lever changed the quality gate. Each test run replaces its coverage capture and exercises
the real production workbench through HTTP. Fallow consumes that fresh execution evidence instead
of an imported coverage archive. Server rendering does not measure browser event handlers, just as
a camera test does not prove an actor's performance. The browser review checks that separate layer.

Treat permission and approval as two different gates. A shareable photo still needs a human's
public approval; withdrawing that approval makes the media URL return 404 even if somebody kept
the URL. Images bypass Next.js optimization so private originals cannot enter its shared cache.
An unsent request preview is also not a saved draft. Its revision and source/task references give
the next workflow enough context to recheck the evidence before persisting a final version.

The buyer handoff now connects those pieces. Think of the inline card catalog as four approved
graphics templates in post-production: answer, review, handoff, and draft. A caller supplies a
result reference, not its own numbers or executable artwork. The server fetches the permitted
evidence before filling the template. A correct prop shape does not make an assertion true.

An explicit offer keeps its amount, timing, conditions, and unanswered questions. A sentence such
as "Could $165,000 work?" stays a human-review item instead of becoming a fabricated offer. The
current chat recognizes bounded single-field questions, not general language understanding, and
says so on screen. No live model is installed.

Seller follow-up is a review chain: buyer blocker, unsent seller request, permissioned response,
human evidence approval, then cited unsent buyer follow-up. Reviewing one answer never accepts
the offer or resolves its other conditions. Drafts keep their evidence revision and become stale
when evidence changes, just as an edit made against yesterday's footage needs another review.

Malformed card calls keep a durable count per tool and logical turn. Retrying the same call does
not increment the count, and retrying the turn cannot reset it. Two distinct rejected calls retire
only that tool for that turn. Missing evidence is a different outcome: a valid request for an
unavailable fact needs human review, not repeated prop repairs.
