import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

mkdirSync(dirname(config.databasePath), { recursive: true });

const db = new DatabaseSync(config.databasePath);

db.exec(`
  PRAGMA journal_mode = WAL;

  -- Discord user <-> GitHub login
  CREATE TABLE IF NOT EXISTS user_links (
    discord_id   TEXT PRIMARY KEY,
    github_login TEXT NOT NULL UNIQUE
  );

  -- Which Discord channels receive notifications for which repository
  CREATE TABLE IF NOT EXISTS repo_channels (
    repo       TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    guild_id   TEXT NOT NULL,
    PRIMARY KEY (repo, channel_id)
  );

  -- People to mention in a channel when a PR has no GitHub reviewers assigned
  CREATE TABLE IF NOT EXISTS channel_assignees (
    channel_id TEXT NOT NULL,
    discord_id TEXT NOT NULL,
    PRIMARY KEY (channel_id, discord_id)
  );

  -- Open pull requests, tracked for reminders
  CREATE TABLE IF NOT EXISTS pull_requests (
    repo                TEXT NOT NULL,
    number              INTEGER NOT NULL,
    title               TEXT NOT NULL,
    url                 TEXT NOT NULL,
    author              TEXT NOT NULL,
    head_ref            TEXT NOT NULL,
    base_ref            TEXT NOT NULL,
    draft               INTEGER NOT NULL DEFAULT 0,
    requested_reviewers TEXT NOT NULL DEFAULT '[]',
    last_activity_at    INTEGER NOT NULL,
    last_reminded_at    INTEGER,
    PRIMARY KEY (repo, number)
  );

  -- Latest review state per reviewer, reset whenever new commits are pushed
  CREATE TABLE IF NOT EXISTS reviews (
    repo         TEXT NOT NULL,
    number       INTEGER NOT NULL,
    github_login TEXT NOT NULL,
    state        TEXT NOT NULL,
    PRIMARY KEY (repo, number, github_login)
  );

  -- Values created at runtime, e.g. the GitHub App made through /setup
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Links made before GitHub sign-in existed were self-declared, so drop them once.
if (!db.prepare("SELECT 1 FROM settings WHERE key = 'links_verified'").get()) {
  db.exec("DELETE FROM user_links; INSERT INTO settings (key, value) VALUES ('links_verified', '1');");
}

// GitHub logins and repo names are case-insensitive, so store them lowercased.
const lower = (s: string) => s.toLowerCase();

export interface PullRequestRow {
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  head_ref: string;
  base_ref: string;
  draft: number;
  requested_reviewers: string;
  last_activity_at: number;
  last_reminded_at: number | null;
}

// ---- user links ----

export function linkUser(discordId: string, githubLogin: string): void {
  db.prepare("DELETE FROM user_links WHERE github_login = ?").run(lower(githubLogin));
  db.prepare(
    "INSERT INTO user_links (discord_id, github_login) VALUES (?, ?) " +
      "ON CONFLICT(discord_id) DO UPDATE SET github_login = excluded.github_login",
  ).run(discordId, lower(githubLogin));
}

export function unlinkUser(discordId: string): boolean {
  return db.prepare("DELETE FROM user_links WHERE discord_id = ?").run(discordId).changes > 0;
}

export function discordIdFor(githubLogin: string): string | undefined {
  const row = db
    .prepare("SELECT discord_id FROM user_links WHERE github_login = ?")
    .get(lower(githubLogin)) as { discord_id: string } | undefined;
  return row?.discord_id;
}

export function githubLoginFor(discordId: string): string | undefined {
  const row = db
    .prepare("SELECT github_login FROM user_links WHERE discord_id = ?")
    .get(discordId) as { github_login: string } | undefined;
  return row?.github_login;
}

// ---- repo <-> channel ----

export function addRepoChannel(repo: string, channelId: string, guildId: string): void {
  db.prepare("INSERT OR IGNORE INTO repo_channels (repo, channel_id, guild_id) VALUES (?, ?, ?)").run(
    lower(repo),
    channelId,
    guildId,
  );
}

export function removeRepoChannel(repo: string, channelId: string): boolean {
  return (
    db.prepare("DELETE FROM repo_channels WHERE repo = ? AND channel_id = ?").run(lower(repo), channelId)
      .changes > 0
  );
}

export function channelsForRepo(repo: string): string[] {
  const rows = db.prepare("SELECT channel_id FROM repo_channels WHERE repo = ?").all(lower(repo)) as {
    channel_id: string;
  }[];
  return rows.map((r) => r.channel_id);
}

export function reposForChannel(channelId: string): string[] {
  const rows = db.prepare("SELECT repo FROM repo_channels WHERE channel_id = ? ORDER BY repo").all(channelId) as {
    repo: string;
  }[];
  return rows.map((r) => r.repo);
}

// ---- channel assignees ----

export function addAssignee(channelId: string, discordId: string): boolean {
  return (
    db
      .prepare("INSERT OR IGNORE INTO channel_assignees (channel_id, discord_id) VALUES (?, ?)")
      .run(channelId, discordId).changes > 0
  );
}

export function removeAssignee(channelId: string, discordId: string): boolean {
  return (
    db.prepare("DELETE FROM channel_assignees WHERE channel_id = ? AND discord_id = ?").run(channelId, discordId)
      .changes > 0
  );
}

export function clearAssignees(channelId: string): number {
  return Number(db.prepare("DELETE FROM channel_assignees WHERE channel_id = ?").run(channelId).changes);
}

export function assigneesForChannel(channelId: string): string[] {
  const rows = db.prepare("SELECT discord_id FROM channel_assignees WHERE channel_id = ?").all(channelId) as {
    discord_id: string;
  }[];
  return rows.map((r) => r.discord_id);
}

// ---- pull requests ----

export function upsertPullRequest(pr: {
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  headRef: string;
  baseRef: string;
  draft: boolean;
  requestedReviewers: string[];
}): void {
  db.prepare(
    `INSERT INTO pull_requests
       (repo, number, title, url, author, head_ref, base_ref, draft, requested_reviewers, last_activity_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(repo, number) DO UPDATE SET
       title = excluded.title,
       url = excluded.url,
       head_ref = excluded.head_ref,
       base_ref = excluded.base_ref,
       draft = excluded.draft,
       requested_reviewers = excluded.requested_reviewers,
       last_activity_at = excluded.last_activity_at`,
  ).run(
    lower(pr.repo),
    pr.number,
    pr.title,
    pr.url,
    lower(pr.author),
    pr.headRef,
    pr.baseRef,
    pr.draft ? 1 : 0,
    JSON.stringify(pr.requestedReviewers.map(lower)),
    Date.now(),
  );
}

export function deletePullRequest(repo: string, number: number): void {
  db.prepare("DELETE FROM pull_requests WHERE repo = ? AND number = ?").run(lower(repo), number);
  db.prepare("DELETE FROM reviews WHERE repo = ? AND number = ?").run(lower(repo), number);
}

export function openPullRequests(): PullRequestRow[] {
  return db.prepare("SELECT * FROM pull_requests WHERE draft = 0").all() as unknown as PullRequestRow[];
}

export function markReminded(repo: string, number: number): void {
  db.prepare("UPDATE pull_requests SET last_reminded_at = ? WHERE repo = ? AND number = ?").run(
    Date.now(),
    lower(repo),
    number,
  );
}

// ---- reviews ----

export function recordReview(repo: string, number: number, githubLogin: string, state: string): void {
  db.prepare(
    "INSERT INTO reviews (repo, number, github_login, state) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(repo, number, github_login) DO UPDATE SET state = excluded.state",
  ).run(lower(repo), number, lower(githubLogin), state);
}

export function clearReviews(repo: string, number: number): void {
  db.prepare("DELETE FROM reviews WHERE repo = ? AND number = ?").run(lower(repo), number);
}

export function reviewersWhoReviewed(repo: string, number: number): string[] {
  const rows = db
    .prepare("SELECT github_login FROM reviews WHERE repo = ? AND number = ?")
    .all(lower(repo), number) as { github_login: string }[];
  return rows.map((r) => r.github_login);
}

// ---- settings ----

export function getSetting(key: string): string | undefined {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}
