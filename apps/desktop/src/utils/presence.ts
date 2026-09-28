import { PresenceStatus } from "@lockal/domain";

/** Human-readable presence line, Telegram-style: "в сети" or "был(а) в сети в 14:32". */
export function formatPresence(user: { presence: string; lastSeenAt: string | null }): string {
  if (user.presence === PresenceStatus.Online || user.presence === "online") {
    return "в сети";
  }
  if (!user.lastSeenAt) return "не в сети";
  const d = new Date(user.lastSeenAt);
  if (Number.isNaN(d.getTime())) return "не в сети";
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfThatDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfThatDay) / 86_400_000);
  if (dayDiff === 0) return `был(а) в сети в ${time}`;
  if (dayDiff === 1) return `был(а) вчера в ${time}`;
  const date = d.toLocaleDateString([], { day: "2-digit", month: "2-digit" });
  return `был(а) ${date} в ${time}`;
}
