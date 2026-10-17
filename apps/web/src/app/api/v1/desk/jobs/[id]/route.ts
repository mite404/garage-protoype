import { requireHttpActor } from "@/server/auth";
import { orm } from "@/server/db";
import { importJobs } from "@/server/db-schema";
import { eq } from "drizzle-orm";
import { getWorkbench } from "@/server/evidence";
import { AppError, success, failure } from "@/server/errors";
import { z } from "zod";

/** Returns the same source-filtered job projection as the workbench, never frozen prompts. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireHttpActor(request);
    const { id } = await params;
    const result = await orm()
      .select({ opportunity_id: importJobs.opportunity_id })
      .from(importJobs)
      .where(eq(importJobs.id, id));
    if (!result.length) throw new AppError(404, "NOT_FOUND", "Job not found.");
    const row = z.object({ opportunity_id: z.string() }).parse(result[0]);
    const job = (await getWorkbench(actor, row.opportunity_id)).jobs.find((j) => j.id === id);
    if (!job) throw new AppError(404, "NOT_FOUND", "Job not found.");
    return success(job);
  } catch (error) {
    return failure(error);
  }
}
