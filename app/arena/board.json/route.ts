import { loadBoard } from "@/lib/arenaBoard";

export const dynamic = "force-dynamic";

/** The public board, from the durable store, local `arena try` runs, the live container or the snapshot. */
export async function GET() {
  const { board, source, asOf } = await loadBoard();
  if (!board) return Response.json({ error: "No board yet." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  return Response.json({ ...board, source, asOf }, { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
}
