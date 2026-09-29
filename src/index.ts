import { Events, MessageFlags } from "discord.js";
import { config } from "./config.js";
import { client } from "./discord/client.js";
import { handleCommand, registerCommands } from "./discord/commands.js";
import { startWebhookServer } from "./github/webhook.js";
import { startReminders } from "./reminder.js";

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in to Discord as ${c.user.tag}`);
  for (const guild of c.guilds.cache.values()) {
    await registerCommands(guild).catch((err) => console.error(`Command registration failed in ${guild.name}:`, err));
  }
  startReminders();
});

client.on(Events.GuildCreate, (guild) => {
  registerCommands(guild).catch((err) => console.error(`Command registration failed in ${guild.name}:`, err));
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
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
