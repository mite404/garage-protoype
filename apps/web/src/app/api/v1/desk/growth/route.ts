import { z } from "zod";
import { requireHttpActor } from "@/server/auth";
import { failure, success } from "@/server/errors";
import {
  getGrowthOperations,
  getGrowthProfile,
  recordGrowthOutcome,
  linkProspectAccount,
} from "@/server/growth-views";
import { importDirectory, qualifyProspect, reviewProspect, routeProspect } from "@/server/growth";
import { enrollSequence, stopOutreach, reconcileMessage } from "@/server/outreach";
import { inviteFeedback } from "@/server/feedback";
import { configureGrowthSchedule } from "@/server/growth-scheduler";
import { parseInput } from "@/server/validation";
import { prepareOutreachExperiment } from "@/server/outreach-experiment";

const command = z
  .object({
    kind: z.enum([
      "import",
      "review",
      "link",
      "route",
      "enroll",
      "experiment",
      "stop",
      "reconcile",
      "qualify",
      "invite",
      "schedule",
      "outcome",
    ]),
    accountId: z.string().max(200).optional(),
    input: z.unknown(),
  })
  .strict();
const accountCommands = {
  review: reviewProspect,
  link: linkProspectAccount,
  route: routeProspect,
  enroll: enrollSequence,
  experiment: prepareOutreachExperiment,
  stop: stopOutreach,
  reconcile: reconcileMessage,
  qualify: qualifyProspect,
  invite: inviteFeedback,
  outcome: recordGrowthOutcome,
};

/** Reads only currently authorized growth projections, with a bounded account cursor. */
export async function GET(request: Request) {
  try {
    const actor = await requireHttpActor(request);
    const url = new URL(request.url);
    const id = url.searchParams.get("accountId");
    return success(
      id
        ? await getGrowthProfile(actor, id)
        : await getGrowthOperations(actor, url.searchParams.get("cursor") ?? ""),
    );
  } catch (error) {
    return failure(error);
  }
}

/** Invokes shared operations. No command activates external delivery or paid model providers. */
export async function POST(request: Request) {
  try {
    const actor = await requireHttpActor(request, true);
    const parsed = parseInput(command, await request.json());
    if (parsed.kind === "import") return success(await importDirectory(actor, parsed.input));
    if (parsed.kind === "schedule")
      return success(await configureGrowthSchedule(actor, parsed.input));
    const id = parseInput(z.string().min(1).max(200), parsed.accountId);
    return success(await accountCommands[parsed.kind](actor, id, parsed.input));
  } catch (error) {
    return failure(error);
  }
}
