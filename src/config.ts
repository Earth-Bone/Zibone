function required(name: string): string {
  // Trim so a stray space or newline pasted into the dashboard does not break signatures or logins.
  const value = process.env[name]?.trim().replace(/^["']|["']$/g, "");
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function number(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (Number.isNaN(value)) {
    throw new Error(`Environment variable ${name} must be a number, got "${raw}"`);
  }
  return value;
}

export const config = {
  discordToken: required("DISCORD_TOKEN"),
  githubWebhookSecret: required("GITHUB_WEBHOOK_SECRET"),
  port: number("PORT", 3000),
  databasePath: process.env.DATABASE_PATH || "./data/bot.db",
  reminderHours: number("REMINDER_HOURS", 24),
  reminderStartHour: number("REMINDER_START_HOUR", 9),
  reminderEndHour: number("REMINDER_END_HOUR", 22),
  timezone: process.env.TIMEZONE || "Asia/Seoul",
  // e.g. https://github.com/apps/zibone/installations/new, shown in /레포 등록 replies
  githubAppInstallUrl: process.env.GITHUB_APP_INSTALL_URL?.trim() || undefined,
};
