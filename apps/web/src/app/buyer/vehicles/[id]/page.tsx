import Link from "next/link";
import { requireActor } from "@/server/auth";
import { listBuyerConversations } from "@/server/assistance";
import { AppError } from "@/server/errors";
import { BuyerAccessNotice } from "@/app/buyer-access-notice";

export const dynamic = "force-dynamic";

/** Connects a public vehicle to the invited buyer's existing conversations, without creating a lead. */
export default async function BuyerConversations({ params }: { params: Promise<{ id: string }> }) {
  let items;
  try {
    items = await listBuyerConversations(await requireActor(), (await params).id);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return <BuyerAccessNotice message={error.message} />;
  }
  return (
    <section>
      <p className="eyebrow mb-4">Private buyer access</p>
      <h1>Your vehicle conversations</h1>
      {!items.length && (
        <p className="mt-5">
          No opportunity is assigned to your account for this vehicle. Ask your specialist for an
          invitation.
        </p>
      )}
      <ul className="mt-6 space-y-4">
        {items.map((item, i) => (
          <li key={item.id}>
            <Link className="button" href={`/buyer/opportunities/${encodeURIComponent(item.id)}`}>
              Open your conversation {i + 1}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
