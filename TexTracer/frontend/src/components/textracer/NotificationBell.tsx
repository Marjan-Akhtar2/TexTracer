import { useState } from "react";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { notificationsApi } from "@/lib/api";
import { errorMessage, fmtDateTime } from "@/lib/labels";
import { useApi } from "@/lib/useApi";

/** In-app notifications. Polls GET /notifications every 30 s; opening an item marks it read (POST /notifications/:id/read). */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const list = useApi(() => notificationsApi.list({ limit: 20 }), [], 30_000);
  const rows = list.data?.data ?? [];
  const unread = rows.filter((n) => !n.readAt);

  async function markRead(id: number) {
    try { await notificationsApi.read(id); list.reload(); } catch (e) { toast.error(errorMessage(e)); }
  }
  async function markAll() {
    try { await Promise.all(unread.map((n) => notificationsApi.read(n.id))); list.reload(); } catch (e) { toast.error(errorMessage(e)); }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Notifications${unread.length ? ` (${unread.length} unread)` : ""}`} className="relative">
          <Bell />
          {unread.length > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-destructive ring-2 ring-card" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="text-sm font-semibold">Notifications</div>
          {unread.length > 0 && <button className="text-xs font-semibold text-primary" onClick={markAll}>Mark all read</button>}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {list.error && <p className="p-4 text-xs text-destructive">{list.error}</p>}
          {!list.error && !rows.length && <p className="p-6 text-center text-xs text-muted-foreground">{list.loading ? "Loading…" : "No notifications."}</p>}
          {rows.map((n) => (
            <button key={n.id} onClick={() => { if (!n.readAt) void markRead(n.id); }} className={`block w-full border-b px-4 py-3 text-left last:border-0 hover:bg-accent ${n.readAt ? "opacity-60" : ""}`}>
              <div className="text-xs font-medium">{n.message}</div>
              <div className="mt-1 text-[10px] text-muted-foreground">{fmtDateTime(n.createdAt)}{n.readAt ? "" : " · unread"}</div>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
