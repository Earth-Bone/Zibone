import { Client, EmbedBuilder, GatewayIntentBits } from "discord.js";

export const client = new Client({ intents: [GatewayIntentBits.Guilds] });

export interface Notification {
  channelId: string;
  mentions: string[];
  roles?: string[];
  /** Not posted; the message shows only mentions and the embed. */
  headline: string;
  embed: EmbedBuilder;
}

export async function send({ channelId, mentions, roles = [], embed }: Notification): Promise<void> {
  const unique = [...new Set(mentions)];
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isSendable()) {
    console.warn(`Cannot send to channel ${channelId}; is the bot a member with Send Messages permission?`);
    return;
  }
  const uniqueRoles = [...new Set(roles)];
  const mentionLine = [...unique.map((id) => `<@${id}>`), ...uniqueRoles.map((id) => `<@&${id}>`)].join(" ");
  await channel.send({
    content: mentionLine || undefined,
    embeds: [embed],
    // Only ping the users and roles we explicitly chose; never @everyone or anything from PR titles.
    allowedMentions: { users: unique, roles: uniqueRoles, parse: [] },
  });
}
