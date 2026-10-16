import { requireHttpActor } from "@/server/auth";
import { getWorkbench } from "@/server/evidence";
import { success, failure } from "@/server/errors";

/** Reads the permission-filtered workbench and its revision, never source bytes by default. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const view = await getWorkbench(await requireHttpActor(request), (await params).id);
    const response = success(view);
    response.headers.set("ETag", `"${view.revision}"`);
    return response;
  } catch (error) {
    return failure(error);
  }
}
