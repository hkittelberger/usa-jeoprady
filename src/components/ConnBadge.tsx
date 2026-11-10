import type { ConnStatus } from "../lib/socket";

export function ConnBadge({ status }: { status: ConnStatus }) {
  if (status === "open" || status === "checking") return null;
  return (
    <div className="fixed top-2 right-2 z-50 rounded-full bg-black/60 px-3 py-1 text-xs text-white flex items-center gap-2">
      <span className="h-2 w-2 rounded-full bg-gold animate-pulse" />
      {status === "notfound" ? "Room not found" : "Reconnecting…"}
    </div>
  );
}
