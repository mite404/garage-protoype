"use agent";
import type { AgentProps } from "@flue/runtime";
import { extend } from "@flue/runtime/cloudflare";
import { SpecialistStream as NodeAgent } from "../../../src/agents/specialist";
import { reconcileTurn } from "../../../src/server/streaming-turn";
import { conversationStore } from "../conversation-store";
import { withDatabaseOwner } from "../database";

// Flue's scan needs a local declaration; behavior, tools and durability stay the shared agent's.
export function SpecialistStream(props: AgentProps) {
  return NodeAgent(props);
}
SpecialistStream.agentName = "SpecialistStream";
SpecialistStream.durability = NodeAgent.durability;

/** Lets the turn driver reconcile paid results against this object's own canonical history. */
export const cloudflare = extend<{ ctx: DurableObjectState }>({
  base: (Base) =>
    class extends Base {
      /** @returns Whether the turn was interrupted instead of resumed. */
      async reconcile(turnId: string) {
        const storage = this.ctx.storage;
        return withDatabaseOwner(storage, () => reconcileTurn(turnId, conversationStore(storage)));
      }
    },
});
