import { WifiOffIcon } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Minimal offline indicator. Persistent banner pinned under the top bar
 * when navigator.onLine flips to false. No fancy queue UI here — phase 5
 * adds the offline write queue.
 */
export function OfflineIndicator() {
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online ? null : (
    <div
      role="status"
      className="border-warning-bg bg-warning-bg text-warning flex items-center gap-2 border-b px-4 py-1.5 text-[12px] font-medium"
    >
      <WifiOffIcon className="size-3.5" strokeWidth={2.2} />
      You're offline · changes will sync when you reconnect
    </div>
  );
}
