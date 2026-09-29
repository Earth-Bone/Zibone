import * as db from "../db.js";
import { Colors, notifyAuthor, notifyQuiet, notifyReviewers, type PrInfo } from "../notify.js";

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
  created_at: string;
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
  requested_reviewer?: GhUser;
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

// GitHub sends one review_requested event per reviewer right after "opened"; the opened message already covers them.
const OPENED_GRACE_MS = 60 * 1000;

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

function save(repo: string, pr: GhPullRequest): void {
  db.upsertPullRequest({
    repo,
    number: pr.number,
    title: pr.title,
    url: pr.html_url,
    author: pr.user.login,
    headRef: pr.head.ref,
    baseRef: pr.base.ref,
    draft: pr.draft,
    requestedReviewers: requestedLogins(pr),
  });
}

export async function handleEvent(event: string, payload: unknown): Promise<void> {
  if (event === "pull_request") return handlePullRequest(payload as PullRequestEvent);
  if (event === "pull_request_review") return handleReview(payload as PullRequestReviewEvent);
}

async function handlePullRequest(e: PullRequestEvent): Promise<void> {
  const repo = e.repository.full_name;
  const pr = e.pull_request;
  if (db.channelsForRepo(repo).length === 0) return;
  const info = toInfo(repo, pr);

  switch (e.action) {
    case "opened":
    case "reopened":
    case "ready_for_review": {
      save(repo, pr);
      if (pr.draft) return;
      const headline =
        e.action === "ready_for_review"
          ? "📝 Draft PR이 리뷰 가능 상태가 됐어요. 리뷰 부탁드려요!"
          : "🔔 새 PR이 올라왔어요. 리뷰 부탁드려요!";
      await notifyReviewers({ pr: info, reviewerLogins: requestedLogins(pr), headline, color: Colors.opened });
      return;
    }

    case "synchronize": {
      const key = `${repo}#${pr.number}`.toLowerCase();
      const reviewed = db.reviewersWhoReviewed(repo, pr.number);
      save(repo, pr);
      // New commits invalidate earlier reviews: ask everyone to look again.
      db.clearReviews(repo, pr.number);
      if (pr.draft) return;
      const now = Date.now();
      if (now - (lastPushNotice.get(key) ?? 0) < PUSH_DEBOUNCE_MS) return;
      lastPushNotice.set(key, now);
      const reviewers = [...new Set([...requestedLogins(pr), ...reviewed])];
      await notifyReviewers({
        pr: info,
        reviewerLogins: reviewers,
        headline: `🔄 새 커밋이 push 됐어요. 변경사항 확인 부탁드려요! (by ${e.sender.login})`,
        color: Colors.push,
      });
      return;
    }

    case "review_requested": {
      save(repo, pr);
      if (pr.draft || !e.requested_reviewer) return;
      if (Date.now() - Date.parse(pr.created_at) < OPENED_GRACE_MS) return;
      await notifyReviewers({
        pr: info,
        reviewerLogins: [e.requested_reviewer.login],
        headline: `👀 ${e.sender.login}님이 리뷰를 요청했어요!`,
        color: Colors.requested,
        useChannelAssigneesAsFallback: false,
      });
      return;
    }

    case "review_request_removed":
    case "edited":
    case "converted_to_draft":
      save(repo, pr);
      return;

    case "closed":
      db.deletePullRequest(repo, pr.number);
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
  if (db.channelsForRepo(repo).length === 0) return;

  const reviewer = e.review.user.login;
  // The author replying to comments on their own PR is not a review.
  if (reviewer.toLowerCase() === pr.user.login.toLowerCase()) return;

  const state = e.review.state.toLowerCase();
  save(repo, pr);
  db.recordReview(repo, pr.number, reviewer, state);

  const headline =
    state === "approved"
      ? `✅ ${reviewer}님이 Approve 했어요!`
      : state === "changes_requested"
        ? `🛠️ ${reviewer}님이 변경을 요청했어요. 반영 부탁드려요!`
        : `💬 ${reviewer}님이 리뷰 코멘트를 남겼어요.`;
  const color =
    state === "approved" ? Colors.approved : state === "changes_requested" ? Colors.changes : Colors.commented;
  const body = e.review.body?.trim();
  const extra = [body ? `> ${body.slice(0, 300).replace(/\n/g, "\n> ")}` : "", `[리뷰 보기](${e.review.html_url})`]
    .filter(Boolean)
    .join("\n");

  await notifyAuthor({ pr: toInfo(repo, pr), headline, color, extra });
}
