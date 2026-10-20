# Task ETAs from observed agent elapsed time

Investigated on 2026-10-20 in `mite404/garage-protoype`, continuing the
[earlier investigation][prior]. This report independently rechecks GitHub timestamps, Amp thread
creation metadata, and four source conversations. It recreates the missing, untracked draft rather
than assuming that another orb's files exist here.

## Conclusion

Give separate **coding-completion** and **PR-merge** ETAs. For a bounded feature similar to Jev,
pairing, or the specialist desk, use **1 to 4 elapsed hours to an initial locally verified coding
completion report** as a provisional starting range. The four examined conversations place that
report between about 49 minutes and 2h44, with one upper bound rather than an exact timestamp.
These observations describe agent workflows, not human coding effort or measured active inference.

Do not promise merge at that time. Across 24 merged PRs, PR opening to merge had a
**14m32s median**, but the **90th percentile was 7h03m12s**, and the maximum was 8h44m30s.
These are descriptive sample statistics, not calibrated forecast confidence levels. They mix
documentation, fixes, and features.

For an already open PR with approval, a green exact head, and no remaining review work, **10 to 20
minutes** is a reasonable provisional merge allowance. That is a planning judgment, not a measured
conditional percentile. If approval, integration, or CI is unresolved, report that dependency and
give a conditional ETA instead of silently adding 15 minutes to coding completion.

The record cannot establish an active-AI-hours estimate or an Amp Medium-specific speed factor.
Historical model, dial, orb size, idle time, and concurrency were not controlled. This continuation
runs in Medium, but its historical observations are not a Medium benchmark.

## Keep the milestones separate

- **Coding complete:** a timestamped agent report that the requested scope and local checks pass.
  Record the scope and commit. A later request changes the forecast; a later discovered defect
  invalidates readiness for that commit. An early partial implementation is not full completion.
- **PR open:** GitHub's `createdAt`. This is a delivery observation, not a coding-completion
  timestamp. Approval to publish can delay it, and work can continue after opening.
- **Merge ready:** the current head has required CI, review, integration, and authorization
  resolved. A local completion report does not establish this state.
- **Merged:** GitHub's `mergedAt`, not the time an automated notification reaches the
  conversation. Deployment and an authenticated working product remain separate milestones.

Elapsed time here includes setup, research, tools, validation, and any intervening waits. The
timestamps do not partition the whole interval into active agent work and idle time. Never relabel
thread-start-to-merge as coding time, and never convert human-day effort labels into agent hours.

## Direct coding-completion evidence

Times below are UTC. Message numbers refer to the linked source conversations. Durations start at
the first received task prompt, not at an originating human request in another conversation.

| Source | Prompt | First full report | Elapsed |
| --- | --- | --- | --- |
| [Jev][jev], Oct 18 | 05:24:04.190 | 06:19:59.258 | 55m55s |
| [Pairing][pair], Oct 19 | 05:14:06.420 | 07:58:18.922 | 2h44m13s |
| [Desk UI][desk], Oct 19 | 18:10:35.628 | at or before 20:30:36.838 | at most 2h20m01s |
| [Buyer-seller][buyer], Oct 19 | 22:06:09.280 | 22:55:22.702 | 49m13s |

Jev message 216 says, "It's built ... Nothing is pushed and no PR is open." This scope excluded
buyer-side quick answers and a municipality accept button. The human requested the button at
07:50:42.565. A rebase onto changed migrations followed. Final local readiness was reported at
08:24:30.747, about 3h00m27s after the prompt. Approval to force-push arrived via another thread
at 15:00:44.154. CI completed at 15:05:10 and GitHub records merge at 15:05:39. The roughly seven
hours from PR opening to merge were not seven hours of coding or a clean approval-only wait.

Pairing's 05:38:31.750 report explicitly said the route and saved records were not wired, so it
does not count as full coding completion. Ethan approved the migration at 06:18:53.246. The full
07:58 report, message 727, still awaited independent review and CI. Later changes fixed stale
outreach, test cleanup, an accidental schema change, and complexity. The final-head report was
16:21:20.356. There is an unexplained 7h54m13s interval between the 08:08:23.138 status and the
16:02:35.804 Puck message. The record does not establish continuous work or a human approval wait
throughout that gap. CI finished at 16:27:37, but its notification arrived at 16:41:34.629.

Desk UI messages 338 and 343 report local completion without exposed timestamps. The next human
message at 20:30:36.838 bounds completion and requests further E2E investigation. It is not the
21:38 bound in the old draft. Publication approval came at 21:41:46.094; the agent then integrated
the test-database ownership change from #30. CI passed at 22:00:04 and #31 merged at 22:00:38.
The initial report and the integrated PR tested different revisions.

Buyer-seller message 288 says, "I haven't merged it, and its CI is still running." Conflicts and
a later carousel E2E timeout required changes. Final-head CI finished at 01:03:08 on Oct 20; #33
merged at 01:05:41. The deployed signed-in route still failed because migrations had targeted the
wrong database. The correction was reported at 01:14:08.605, and Ethan confirmed recovery at
01:16:57.167. Merge was not proof of a working deployment.

These cases establish real initial-completion observations, not that the first completion report
always survives independent review. No coding-completion median is reported because the small
sample includes an upper bound and differing post-report scope changes.

## Wider delivery observations

This table uses Amp `find_thread` creation metadata and GitHub PR `createdAt`. Dates are UTC in
2026. Elapsed values round to the nearest minute. These are **thread-to-PR delivery spans**, not
direct coding-completion measurements. The ten tasks were selected by the prior investigation,
so this is a convenience sample rather than all tasks or a random sample.

| PR | Task/thread | Thread created | PR opened | Span |
| --- | --- | --- | --- | --- |
| 13 | [Latency][lat] | 10-18 02:36:18 | 10-18 04:41:09 | 2h05 |
| 21 | [Jev][jev] | 10-18 05:24:03 | 10-18 08:02:27 | 2h38 |
| 22 | [Extraction][ext] | 10-18 04:20:31 | 10-18 09:24:19 | 5h04 |
| 23 | [Cloudflare][cf] | 10-18 05:20:59 | 10-18 16:59:11 | 11h38 |
| 27 | [NY growth][ny] | 10-19 04:05:28 | 10-19 07:12:34 | 3h07 |
| 28 | [Pairing][pair] | 10-19 05:14:05 | 10-19 07:57:29 | 2h43 |
| 29 | [PostHog][ph] | 10-19 04:45:16 | 10-19 17:50:36 | 13h05 |
| 30 | [Test DB][db] | 10-19 18:50:13 | 10-19 20:57:20 | 2h07 |
| 31 | [Desk UI][desk] | 10-19 18:10:34 | 10-19 21:52:23 | 3h42 |
| 33 | [Buyer-seller][buyer] | 10-19 22:06:08 | 10-19 22:54:57 | 49m |

The median delivery span across these ten tasks is 2h55m15s, calculated from unrounded metadata.
For the explicitly selected feature subset #21, #27, #28, #31, and #33, it is 2h43m24s, with a
49-minute to 3h42 range. This subset excludes the evaluation/spike tasks and PostHog. Its median
must not be presented as an all-feature coding median.

Extraction and Cloudflare took 5h04 and 11h38 to PR opening. A provisional investigation/spike
delivery allowance is therefore **5 to 12 hours**, with explicit low confidence. PostHog's 13h05
span is a counterexample to treating four hours as a feature deadline. Its internal phases were
not audited here, so no cause is assigned to that long span.

PR bodies link to the corresponding implementation threads for eight of these ten joins. #13
links to its coordinator, not the latency worker, and #29 has no thread link. Their worker links
were recovered through Amp metadata and the prior investigation. Neither is a direct PR-body join.

## PR merge and CI distributions

Primary repository sources are the [GitHub PR records][prs] and [Checks workflow runs][checks].
The fixed sampling window is 2026-10-18T00:00:00Z inclusive to 2026-10-20T02:00:00Z exclusive.
There are 25 PRs created in that window, of which 24 merged before its end. #12 has no `mergedAt`
in the fetched record and is excluded from completed-duration statistics. Consequently the merge
distribution does not account for the eventual duration of that unfinished PR.

| PR open to merge | Duration |
| --- | --- |
| 25th percentile | 8m37s |
| Median | 14m32s |
| 75th percentile | 36m49s |
| 90th percentile | 7h03m12s |
| Maximum | 8h44m30s |

Durations use exact timestamp differences. The median averages the two central values. Percentiles
use nearest rank, with rounding only for display. The old draft floored durations first and used
an upper-middle observation, producing a different median.

The three longest merged PRs were #21 (7h03m12s), #22 (7h25m18s), and #28 (8h44m30s).
Their PRs opened at 04:02, 05:24, and 03:57 America/New_York time, respectively, and merged at
11:05, 12:49, and 12:41. But #27 opened at 03:12 and merged at 03:27. These dates use EDT,
UTC minus four hours. Clock time alone does not establish availability or explain the delays.
In particular, #28's gap cannot be attributed to Ethan sleeping. #22 was not phase-audited here.

For completed `Checks` workflow runs created and updated within the same window, GitHub returns
59 runs: 55 successes, three failures, and one cancellation. Successful runs had a 6m51s median
and 20m13s maximum. The cancelled run spanned 6h00m18s and is reported separately, not silently
discarded. Push and PR runs are both included, so runs are not independent tasks. These spans use
workflow `createdAt` to `updatedAt`, not job execution time or active agent time.

A failed head means another diagnosis, fix, and validation round. Do not budget exactly seven
minutes per failure: job time is only part of that round, and the cause can be an integration
conflict or an actual defect. #28 also demonstrates almost 14 minutes of notification delay
after successful CI, independent of test execution.

## What can be forecast reliably

Use thread creation as a reproducible receipt-time proxy, or the first task prompt where exposed.
An explicit complete report with scope, commit, and gate evidence is stronger than PR creation for
coding completion. Use GitHub timestamps for PR opening, exact-head checks, and merge. Do not use
notification receipt timestamps in place of those underlying events.

Thread `updatedAt` is a last-update timestamp, not a completion signal. A commit author date is
also not an activity interval: inherited commits, squash merges, and rebases can obscure task
boundaries. Thread links in PR bodies are useful joins but are not universal. Plan dates and
Medium/Large effort labels are context, not measurements of agent elapsed time. This sample is
too small and confounded to conclude that such labels have zero predictive value.

For the next task, record the receipt time, scope, analogous completed task, and current state.
Give a coding range from the matching observations above, with the latest real validation as a
checkpoint. Give merge separately, conditional on approval, current-head CI, and review. Refresh
both when scope changes, a dependency lands, a test fails, or the agent pauses. Do not subtract
elapsed time mechanically and force an overdue task's remaining estimate to zero.

If a person needs a calendar ETA, render the resulting time in America/New_York and name the
conditions. Do not assume an overnight wait or a midday return without an actual approval or
availability signal. When the unresolved wait is unbounded, say "coding ETA X; merge after Y"
rather than inventing a deadline.

For future calibration, keep the initial forecast and actual milestone timestamps in the task's
existing conversation. Compare forecast misses separately for coding and merge. Record blocked
intervals explicitly if active-agent time is needed. No scheduler or estimator service is justified
by this small dataset, and no accuracy claim is possible without out-of-sample forecasts.

## Reproduce the GitHub calculations

The commands below are read-only. Run them against this repository with authenticated `gh`.
The original recheck fetched fewer than 100 PRs and 200 runs, so those limits covered this window.
If later history exceeds the limits, paginate the API rather than treating a truncated list as all
history. Re-query each listed Amp thread with `find_thread` using `id:<thread URL>` to check its
creation metadata. Use `read_thread` on the four detailed sources to verify their message events.

```sh
gh pr list --state all --limit 100 \
  --json number,title,createdAt,mergedAt,body,url > /tmp/eta-prs.json
gh run list --limit 200 \
  --json databaseId,workflowName,event,createdAt,updatedAt,status,conclusion,url \
  > /tmp/eta-runs.json
python3 - <<'PY'
import datetime as dt
import json
import math
import statistics

def date(value):
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))

start, end = map(date, ["2026-10-18T00:00:00Z", "2026-10-20T02:00:00Z"])
prs = [p for p in json.load(open("/tmp/eta-prs.json"))
       if start <= date(p["createdAt"]) < end]
merged = [p for p in prs if p["mergedAt"] and date(p["mergedAt"]) < end]
minutes = sorted((date(p["mergedAt"]) - date(p["createdAt"])).total_seconds() / 60
                 for p in merged)
print("PRs, merged:", len(prs), len(merged))
print("merge median minutes:", statistics.median(minutes))
print("nearest-rank p25, p75, p90 minutes:",
      [minutes[math.ceil(len(minutes) * q) - 1] for q in (.25, .75, .9)])
print("merge max minutes:", max(minutes))
runs = [r for r in json.load(open("/tmp/eta-runs.json"))
        if r["workflowName"] == "Checks" and r["status"] == "completed"
        and start <= date(r["createdAt"]) < end and date(r["updatedAt"]) < end]
for outcome in sorted({r["conclusion"] for r in runs}):
    values = [(date(r["updatedAt"]) - date(r["createdAt"])).total_seconds() / 60
              for r in runs if r["conclusion"] == outcome]
    print("CI outcome, n, median, max:", outcome, len(values),
          statistics.median(values), max(values))
PY
```

The sample is historical and bounded, not a live ETA for any currently running task. Raw GitHub
exports from this recheck accompany this investigation as review artifacts. They are not required
to execute the reproduction commands.

[prior]: https://ampcode.com/threads/T-01a15a07-6cdc-754b-bff9-706cd651c908
[lat]: https://ampcode.com/threads/T-01a14cdd-f826-7329-b7b6-6f4ad0943d42
[jev]: https://ampcode.com/threads/T-01a14d77-8c15-7539-8d54-9ab01dc5e671
[ext]: https://ampcode.com/threads/T-01a14d3d-60eb-733e-8da1-e0976b2ef368
[cf]: https://ampcode.com/threads/T-01a14d74-bdbe-72af-85a8-eb822babd5f2
[ny]: https://ampcode.com/threads/T-01a15255-f788-734b-b7c3-d318118d72e4
[pair]: https://ampcode.com/threads/T-01a15294-c894-742b-802b-40ed16c9efb9
[ph]: https://ampcode.com/threads/T-01a1527a-689d-76f9-8a49-a4cd08733d08
[db]: https://ampcode.com/threads/T-01a1557f-fb9a-7485-acf5-585ca0f11e1f
[desk]: https://ampcode.com/threads/T-01a1555b-ae40-709c-bce8-d5ae0ec0735f
[buyer]: https://ampcode.com/threads/T-01a15633-5798-73e6-ba1f-bc7337e4130f
[prs]: https://github.com/mite404/garage-protoype/pulls?q=is%3Apr
[checks]: https://github.com/mite404/garage-protoype/actions/workflows/checks.yml
