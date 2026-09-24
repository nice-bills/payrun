import { PolicyBoard } from "@/components/policy/PolicyBoard";
import { loadDesk } from "@/lib/data";

export const dynamic = "force-dynamic";

export default function PolicyPage() {
  const data = loadDesk();
  if (!data.policy) {
    return <p className="p-10 text-ink">No policy yet. Run the init command to load one.</p>;
  }
  return (
    <PolicyBoard
      policies={data.policies}
      live={data.policy}
      gaps={data.gaps}
      replay={data.replay}
      names={Object.fromEntries(data.contractors.map((c) => [c.id, c.name]))}
    />
  );
}
