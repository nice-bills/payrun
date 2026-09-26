import { ArenaLog } from "@/src/core/arena";

export const dynamic = "force-dynamic";

/** The board from local `arena try` runs (data/arena.json). Set NEXT_PUBLIC_ARENA_BOARD_URL=/arena/board.json to use it. */
export function GET() {
  return Response.json(new ArenaLog("data/arena.json").board(), { headers: { "Cache-Control": "no-store" } });
}
