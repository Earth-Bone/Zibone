import { Events, MessageFlags } from "discord.js";
import { config } from "./config.js";
import { client } from "./discord/client.js";
import { handleCommand, registerCommands } from "./discord/commands.js";
import { startWebhookServer } from "./github/webhook.js";
import { startReminders } from "./reminder.js";

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in to Discord as ${c.user.tag}`);
  await setDefaultDescription().catch((err) => console.error("Could not set app description:", err));
  for (const guild of c.guilds.cache.values()) {
    await registerCommands(guild).catch((err) => console.error(`Command registration failed in ${guild.name}:`, err));
  }
  startReminders();
});

// Shown on the bot's profile. Only filled in when empty, so edits made in the Developer Portal win.
const DESCRIPTION = [
  "🌏 지본은 GitHub PR 리뷰 요청을 대신 해주는 봇이에요.",
  "PR이 올라오면 디스코드 채널에 링크와 함께 리뷰어를 태그하고, 새 커밋이나 리뷰가 올라올 때도 필요한 사람을 다시 불러줘요. 리뷰가 늦어지면 리마인더까지!",
  '이제 "리뷰 좀 해주세요" 매번 말하지 마세요.',
  "",
  "/도움말 로 사용법을 확인하세요.",
].join("\n");

async function setDefaultDescription(): Promise<void> {
  const app = await client.application!.fetch();
  if (app.description) return;
  await app.edit({ description: DESCRIPTION });
  console.log("Set Discord app description");
}

client.on(Events.GuildCreate, (guild) => {
  registerCommands(guild).catch((err) => console.error(`Command registration failed in ${guild.name}:`, err));
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  console.log(`/${interaction.commandName} ${interaction.options.getSubcommand(false) ?? ""} by ${interaction.user.tag} in #${interaction.channelId}`);
  try {
    await handleCommand(interaction);
  } catch (err) {
    console.error(`/${interaction.commandName} failed:`, err);
    const reply = { content: "명령 처리 중 오류가 났어요.", flags: MessageFlags.Ephemeral } as const;
    if (interaction.replied || interaction.deferred) await interaction.followUp(reply).catch(() => {});
    else await interaction.reply(reply).catch(() => {});
  }
});

startWebhookServer();
await client.login(config.discordToken);
