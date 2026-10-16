# Signal Desk behind the scenes

## The Story So Far

The first implementation unit builds the locked doors before the evidence workbench. The real
Next.js app runs without credentials, but it tells the truth about the missing sign-in service.
It never swaps in a pretend user to make the demo look finished.

## Cast & Crew (Architecture)

Supabase Auth checks the person's identity at the studio entrance. PostgreSQL keeps the current
call sheet. Being on the lot does not authorize someone to enter every set or charge the production.

`src/server/auth.ts` verifies the Supabase session. `src/server/access.ts` reads current invitation,
role, spending permission, and record membership. `src/server/records.ts` selects the facts and
source bytes that those permissions allow. Next.js routes return those permitted results.

## Behind the Scenes (Decisions)

We do not trust a role in user-editable metadata. The application stores its own role and access
revocation timestamp in a private schema. Even a previously valid actor is checked again when it
opens a record or requests spending permission.

The approved public record is a separate export, like a final delivery cut. It does not serialize
the entire editing project and hope that nobody notices the private tracks. Each fact needs both
review approval and permission to share. Original source files are never public downloads.

Access helpers accept the current PostgreSQL transaction client. The next unit can check access
and reserve a budget through one connection rather than accidentally reading a different snapshot.
That unit still owns its locks and budget accounting.

The inference boundary now reserves money before each numbered provider attempt, like approving a
purchase order before a shoot. PostgreSQL reserves against both the person's allowance and the
production's total allowance together. Two browser tabs cannot each spend the same last dollar.

Permission locks last only through admission. Provider calls run after the transaction commits,
without occupying a database connection. A revocation that commits first stops admission. Once
an attempt is authorized, revocation cannot recall it. Revoked access cannot retrieve its result.

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
