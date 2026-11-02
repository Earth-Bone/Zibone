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

  -- People or roles to mention in a channel when a PR has no GitHub reviewers assigned
  CREATE TABLE IF NOT EXISTS channel_assignees (
    channel_id TEXT NOT NULL,
    discord_id TEXT NOT NULL,
    kind       TEXT NOT NULL DEFAULT 'user', -- 'user' or 'role'
    PRIMARY KEY (channel_id, discord_id)
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

// Assignees could only be users before roles were supported.
const assigneeColumns = db.prepare("PRAGMA table_info(channel_assignees)").all() as { name: string }[];
if (!assigneeColumns.some((c) => c.name === "kind")) {
  db.exec("ALTER TABLE channel_assignees ADD COLUMN kind TEXT NOT NULL DEFAULT 'user'");
}

// Pull requests and reviews were only tracked for reminders, which were removed.
db.exec("DROP TABLE IF EXISTS pull_requests; DROP TABLE IF EXISTS reviews;");

// GitHub logins and repo names are case-insensitive, so store them lowercased.
const lower = (s: string) => s.toLowerCase();

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

export type AssigneeKind = "user" | "role";

export function addAssignee(channelId: string, discordId: string, kind: AssigneeKind): boolean {
  return (
    db
      .prepare("INSERT OR IGNORE INTO channel_assignees (channel_id, discord_id, kind) VALUES (?, ?, ?)")
      .run(channelId, discordId, kind).changes > 0
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

export function assigneesForChannel(channelId: string): { users: string[]; roles: string[] } {
  const rows = db.prepare("SELECT discord_id, kind FROM channel_assignees WHERE channel_id = ?").all(channelId) as {
    discord_id: string;
    kind: AssigneeKind;
  }[];
  return {
    users: rows.filter((r) => r.kind === "user").map((r) => r.discord_id),
    roles: rows.filter((r) => r.kind === "role").map((r) => r.discord_id),
  };
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
