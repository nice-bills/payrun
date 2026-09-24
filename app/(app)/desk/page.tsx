import { Desk } from "@/components/desk/Desk";
import { loadDesk } from "@/lib/data";

export const dynamic = "force-dynamic";

export default function DeskPage() {
  const data = loadDesk();
  return <Desk items={data.items} contractors={data.contractors} />;
}
