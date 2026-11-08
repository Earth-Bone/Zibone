import * as db from "../db.js";
import { Colors, notifyQuiet, notifyReviewers, type PrInfo } from "../notify.js";

// Minimal shapes of the GitHub webhook payload fields we use.
interface GhUser {
  login: string;
}
interface GhPullRequest {
  number: number;
  title: string;
  html_url: string;
  draft: boolean;
  merged: boolean;
  state: "open" | "closed";
  user: GhUser;
  head: { ref: string };
  base: { ref: string };
  requested_reviewers: (GhUser | { name: string; slug: string })[];
}
interface PullRequestEvent {
  action: string;
  number: number;
  pull_request: GhPullRequest;
  repository: { full_name: string };
  sender: GhUser;
}
interface PullRequestReviewEvent {
  action: string;
  review: { state: string; user: GhUser; html_url: string; body: string | null };
  pull_request: GhPullRequest;
  repository: { full_name: string };
}

// Several pushes in a row should produce one ping, not five.
const PUSH_DEBOUNCE_MS = 5 * 60 * 1000;
const lastPushNotice = new Map<string, number>();

function toInfo(repo: string, pr: GhPullRequest): PrInfo {
  return {
    repo,
    number: pr.number,
    title: pr.title,
    url: pr.html_url,
    author: pr.user.login,
    headRef: pr.head.ref,
    baseRef: pr.base.ref,
  };
}

/** Individual users only; team review requests have no login. */
function requestedLogins(pr: GhPullRequest): string[] {
  return pr.requested_reviewers.flatMap((r) => ("login" in r ? [r.login] : []));
}


// A repo can receive the same event twice: once from a repo webhook and once from the GitHub App.
// Delivery IDs differ between the two, so recognise duplicates by content instead.
const DEDUPE_MS = 10 * 60 * 1000;
const recentEvents = new Map<string, number>();

function isDuplicate(event: string, p: Record<string, any>): boolean {
  const key = [
    event,
    p.action,
    p.repository?.full_name?.toLowerCase(),
    p.pull_request?.number,
    p.pull_request?.updated_at,
    p.pull_request?.head?.sha,
    p.review?.id,
    p.requested_reviewer?.login,
  ].join("|");
  const now = Date.now();
  for (const [k, at] of recentEvents) if (now - at > DEDUPE_MS) recentEvents.delete(k);
  if (recentEvents.has(key)) return true;
  recentEvents.set(key, now);
  return false;
}

export async function handleEvent(event: string, payload: unknown): Promise<void> {
  const p = payload as Record<string, any>;
  const repo: string = p.repository?.full_name ?? "?";
  if (isDuplicate(event, p)) {
    console.log(`GitHub ${event}.${p.action} from ${repo} ignored (duplicate delivery)`);
    return;
  }
  const channels = db.channelsForRepo(repo);
  console.log(
    `GitHub ${event}.${p.action} from ${repo} -> ${channels.length} channel(s)` +
      (channels.length === 0 ? " (run /레포 등록 repo:" + repo + " in Discord)" : ""),
  );
  if (event === "pull_request") return handlePullRequest(payload as PullRequestEvent);
  if (event === "pull_request_review") return handleReview(payload as PullRequestReviewEvent);
}

async function handlePullRequest(e: PullRequestEvent): Promise<void> {
  const repo = e.repository.full_name;
  const pr = e.pull_request;
  if (db.channelsForRepo(repo).length === 0) return;
  const info = toInfo(repo, pr);

  switch (e.action) {
    // The only events that mention anyone: a PR has just become ready for review.
    case "opened":
    case "reopened":
    case "ready_for_review": {
      if (pr.draft) return;
      const headline =
        e.action === "ready_for_review"
          ? "📝 Draft PR이 리뷰 가능 상태가 됐어요. PR 확인해 주세요!"
          : "🔔 새 PR이 올라왔어요! PR 확인해 주세요!";
      await notifyReviewers({ pr: info, reviewerLogins: requestedLogins(pr), headline, color: Colors.opened });
      return;
    }

    case "synchronize": {
      if (pr.draft || pr.state !== "open") return;
      const key = `${repo}#${pr.number}`.toLowerCase();
      const now = Date.now();
      if (now - (lastPushNotice.get(key) ?? 0) < PUSH_DEBOUNCE_MS) return;
      lastPushNotice.set(key, now);
      await notifyQuiet({
        pr: info,
        headline: `🔄 새 커밋이 push 됐어요. (by ${e.sender.login})`,
        color: Colors.push,
      });
      return;
    }

    case "closed":
      lastPushNotice.delete(`${repo}#${pr.number}`.toLowerCase());
      await notifyQuiet({
        pr: info,
        headline: pr.merged ? "🎉 PR이 머지됐어요!" : "🚫 PR이 닫혔어요.",
        color: pr.merged ? Colors.merged : Colors.closed,
      });
      return;
  }
}

async function handleReview(e: PullRequestReviewEvent): Promise<void> {
  if (e.action !== "submitted") return;
  const repo = e.repository.full_name;
  const pr = e.pull_request;
  // Reviews left after a PR is merged or closed are not actionable.
  if (pr.state !== "open") return;
  if (db.channelsForRepo(repo).length === 0) return;

  // Approvals and plain comments are visible on GitHub; only a change request needs the channel's attention.
  if (e.review.state.toLowerCase() !== "changes_requested") return;
  const reviewer = e.review.user.login;
  // The author replying to comments on their own PR is not a review.
  if (reviewer.toLowerCase() === pr.user.login.toLowerCase()) return;

  const body = e.review.body?.trim();
  const extra = [body ? `> ${body.slice(0, 300).replace(/\n/g, "\n> ")}` : "", `[리뷰 보기](${e.review.html_url})`]
    .filter(Boolean)
    .join("\n");

  await notifyQuiet({
    pr: toInfo(repo, pr),
    headline: `🛠️ ${reviewer}님이 변경을 요청했어요.`,
    color: Colors.changes,
    extra,
  });
}
