import { EmbedBuilder } from "discord.js";
import * as db from "./db.js";
import { client, send } from "./discord/client.js";

export const Colors = {
  opened: 0x2da44e,
  push: 0x0969da,
  requested: 0xbf8700,
  approved: 0x2da44e,
  changes: 0xcf222e,
  commented: 0x6e7781,
  merged: 0x8250df,
  closed: 0x6e7781,
  reminder: 0xbf8700,
} as const;

export interface PrInfo {
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  headRef: string;
  baseRef: string;
}

export function prEmbed(pr: PrInfo, color: number, extra?: string): EmbedBuilder {
  const lines = [pr.url, `작성자: ${pr.author} · \`${pr.headRef}\` → \`${pr.baseRef}\``];
  if (extra) lines.push(extra);
  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: pr.repo })
    .setTitle(`[#${pr.number}] ${pr.title}`.slice(0, 256))
    .setURL(pr.url)
    .setDescription(lines.join("\n"))
    .setFooter({ text: "지본", iconURL: client.user?.displayAvatarURL() });
}

/** GitHub logins -> Discord IDs. Unlinked logins are returned separately so we can show them as text. */
export function resolveLogins(logins: string[]): { ids: string[]; unlinked: string[] } {
  const ids: string[] = [];
  const unlinked: string[] = [];
  for (const login of logins) {
    const id = db.discordIdFor(login);
    if (id) ids.push(id);
    else unlinked.push(login);
  }
  return { ids, unlinked };
}

function unlinkedNote(unlinked: string[]): string | undefined {
  if (unlinked.length === 0) return undefined;
  return `디스코드 미연결: ${unlinked.map((l) => `\`${l}\``).join(", ")} (\`/연결\`로 연결하세요)`;
}

/**
 * Sends one message per channel subscribed to the repo.
 * Reviewer logins take priority; if there are none, each channel's saved assignees are mentioned instead.
 */
export async function notifyReviewers(opts: {
  pr: PrInfo;
  reviewerLogins: string[];
  headline: string;
  color: number;
  useChannelAssigneesAsFallback?: boolean;
}): Promise<void> {
  const { pr, headline, color } = opts;
  const authorId = db.discordIdFor(pr.author);
  const logins = opts.reviewerLogins.filter((l) => l.toLowerCase() !== pr.author.toLowerCase());
  const { ids, unlinked } = resolveLogins(logins);

  for (const channelId of db.channelsForRepo(pr.repo)) {
    let mentions = ids;
    if (logins.length === 0 && opts.useChannelAssigneesAsFallback !== false) {
      mentions = db.assigneesForChannel(channelId);
    }
    mentions = mentions.filter((id) => id !== authorId);
    await send({ channelId, mentions, headline, embed: prEmbed(pr, color, unlinkedNote(unlinked)) });
  }
}

/** Mentions the PR author, e.g. after a review is submitted. */
export async function notifyAuthor(opts: { pr: PrInfo; headline: string; color: number; extra?: string }): Promise<void> {
  const authorId = db.discordIdFor(opts.pr.author);
  const note = authorId ? opts.extra : [opts.extra, unlinkedNote([opts.pr.author])].filter(Boolean).join("\n");
  for (const channelId of db.channelsForRepo(opts.pr.repo)) {
    await send({
      channelId,
      mentions: authorId ? [authorId] : [],
      headline: opts.headline,
      embed: prEmbed(opts.pr, opts.color, note || undefined),
    });
  }
}

/** Posts without mentioning anyone (merged / closed). */
export async function notifyQuiet(opts: { pr: PrInfo; headline: string; color: number }): Promise<void> {
  for (const channelId of db.channelsForRepo(opts.pr.repo)) {
    await send({ channelId, mentions: [], headline: opts.headline, embed: prEmbed(opts.pr, opts.color) });
  }
}
