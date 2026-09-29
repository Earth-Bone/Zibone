import { config } from "./config.js";
import * as db from "./db.js";
import { Colors, notifyReviewers } from "./notify.js";

const CHECK_INTERVAL_MS = 15 * 60 * 1000;

function localHour(): number {
  const hour = new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: config.timezone }).format(
    new Date(),
  );
  return Number(hour);
}

async function sendReminders(): Promise<void> {
  const hour = localHour();
  if (hour < config.reminderStartHour || hour >= config.reminderEndHour) return;

  const threshold = config.reminderHours * 60 * 60 * 1000;
  const now = Date.now();

  for (const pr of db.openPullRequests()) {
    const since = Math.max(pr.last_activity_at, pr.last_reminded_at ?? 0);
    if (now - since < threshold) continue;

    // GitHub drops a reviewer from requested_reviewers once they submit a review,
    // so whoever is still listed has not reviewed yet.
    const pending = JSON.parse(pr.requested_reviewers) as string[];
    // Nobody pending but someone reviewed since the last push: the ball is in the author's court.
    if (pending.length === 0 && db.reviewersWhoReviewed(pr.repo, pr.number).length > 0) continue;

    const hours = Math.floor((now - pr.last_activity_at) / (60 * 60 * 1000));
    await notifyReviewers({
      pr: {
        repo: pr.repo,
        number: pr.number,
        title: pr.title,
        url: pr.url,
        author: pr.author,
        headRef: pr.head_ref,
        baseRef: pr.base_ref,
      },
      reviewerLogins: pending,
      headline: `⏰ 이 PR이 ${hours}시간째 리뷰를 기다리고 있어요!`,
      color: Colors.reminder,
    });
    db.markReminded(pr.repo, pr.number);
  }
}

export function startReminders(): void {
  if (config.reminderHours <= 0) {
    console.log("Reminders disabled (REMINDER_HOURS=0)");
    return;
  }
  setInterval(() => {
    sendReminders().catch((err) => console.error("Reminder check failed:", err));
  }, CHECK_INTERVAL_MS);
  console.log(`Reminders every ${config.reminderHours}h for idle PRs`);
}
