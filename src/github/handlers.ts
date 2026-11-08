import * as db from "../db.js";
import { Colors, notifyReviewers, type PrInfo } from "../notify.js";

// Minimal shapes of the GitHub webhook payload fields we use.
interface GhUser {
  login: string;
}
interface GhPullRequest {
  number: number;
  title: string;
  html_url: string;
  draft: boolean;
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
}
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
}

async function handlePullRequest(e: PullRequestEvent): Promise<void> {
  // Only a newly posted PR is announced; pushes, reviews, merges and closes stay on GitHub.
  if (e.action !== "opened" && e.action !== "ready_for_review") return;
  const repo = e.repository.full_name;
  const pr = e.pull_request;
  if (pr.draft || db.channelsForRepo(repo).length === 0) return;
  const headline =
    e.action === "ready_for_review"
      ? "📝 Draft PR이 리뷰 가능 상태가 됐어요. PR 확인해 주세요!"
      : "🔔 새 PR이 올라왔어요! PR 확인해 주세요!";
  await notifyReviewers({ pr: toInfo(repo, pr), reviewerLogins: requestedLogins(pr), headline, color: Colors.opened });
}
