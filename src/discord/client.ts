import { Client, EmbedBuilder, GatewayIntentBits } from "discord.js";

export const client = new Client({ intents: [GatewayIntentBits.Guilds] });

export interface Notification {
  channelId: string;
  mentions: string[];
  headline: string;
  embed: EmbedBuilder;
}

export async function send({ channelId, mentions, headline, embed }: Notification): Promise<void> {
  const unique = [...new Set(mentions)];
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isSendable()) {
    console.warn(`Cannot send to channel ${channelId}; is the bot a member with Send Messages permission?`);
    return;
  }
  const mentionLine = unique.map((id) => `<@${id}>`).join(" ");
  await channel.send({
    content: mentionLine ? `${mentionLine}\n${headline}` : headline,
    embeds: [embed],
    // Only ping the users we explicitly chose; never @everyone or roles from PR titles.
    allowedMentions: { users: unique, parse: [] },
  });
}
