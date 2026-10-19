"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { postPrototypeCommand } from "@/app/prototype-command";

/** Creates the labelled synthetic walkthrough; it sends nothing and touches no real department. */
export default function SeedWalkthrough() {
  const router = useRouter();
  const [problem, setProblem] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <>
      <button
        className="quiet-button mt-4"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setProblem("");
          try {
            await postPrototypeCommand(
              "/api/v1/desk/sourcing",
              JSON.stringify({ kind: "seed_synthetic" }),
              crypto.randomUUID(),
            );
            router.refresh();
          } catch (failure) {
            setProblem(String(failure instanceof Error ? failure.message : failure));
          } finally {
            setPending(false);
          }
        }}
      >
        Create synthetic walkthrough
      </button>
      {problem && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {problem}
        </p>
      )}
    </>
  );
}
