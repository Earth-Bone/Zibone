import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type Guild,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { config } from "../config.js";
import * as db from "../db.js";
import { createSignInUrl } from "../github/oauth.js";

const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;

/** Accepts a GitHub link (https://github.com/owner/name, with or without .git or extra path) or plain owner/name. */
function parseRepo(input: string): string | null {
  const path = input
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "")
    .split(/[?#]/)[0];
  const [owner, name] = path.split("/");
  const repo = `${owner}/${(name ?? "").replace(/\.git$/, "")}`;
  return REPO_PATTERN.test(repo) ? repo : null;
}

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("연결")
    .setDescription("GitHub 로그인으로 내 디스코드 계정과 GitHub 계정을 연결해요"),

  new SlashCommandBuilder()
    .setName("연결해제")
    .setDescription("내 GitHub 계정 연결을 해제해요"),

  new SlashCommandBuilder()
    .setName("레포")
    .setDescription("이 채널에서 알림 받을 GitHub 레포를 관리해요")
    .addSubcommand((s) =>
      s
        .setName("등록")
        .setDescription("이 채널에 레포 PR 알림을 연결해요")
        .addStringOption((o) => o.setName("repo").setDescription("GitHub 레포 링크 (예: https://github.com/Earth-Bone/my-app)").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("해제")
        .setDescription("이 채널에서 레포 알림을 끊어요")
        .addStringOption((o) => o.setName("repo").setDescription("GitHub 레포 링크").setRequired(true)),
    )
    .addSubcommand((s) => s.setName("목록").setDescription("이 채널에 연결된 레포를 보여줘요")),

  new SlashCommandBuilder()
    .setName("담당자")
    .setDescription("이 채널에서 PR 알림 때 태그할 사람을 관리해요")
    .addSubcommand((s) =>
      s
        .setName("추가")
        .setDescription("태그할 사람을 추가해요")
        .addUserOption((o) => o.setName("user").setDescription("추가할 사람").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("제거")
        .setDescription("태그 대상에서 빼요")
        .addUserOption((o) => o.setName("user").setDescription("뺄 사람").setRequired(true)),
    )
    .addSubcommand((s) => s.setName("목록").setDescription("현재 태그 대상을 보여줘요"))
    .addSubcommand((s) => s.setName("초기화").setDescription("이 채널의 담당자를 모두 지워요")),

  new SlashCommandBuilder().setName("도움말").setDescription("지본 사용법을 보여줘요"),
].map((c) => c.toJSON());

export async function registerCommands(guild: Guild): Promise<void> {
  await guild.commands.set(commandDefinitions);
  console.log(`Registered slash commands in guild "${guild.name}"`);
}

const HELP = [
  "**지본 사용법** 🌏",
  "",
  "**1. 레포 연결**",
  "`/레포 등록 repo:https://github.com/owner/name` → GitHub 로그인으로 레포 쓰기 권한을 확인한 뒤 이 채널로 PR 알림을 받아요",
  "레포에 지본 GitHub App이 설치돼 있어야 해요 (설치 링크는 등록 답장에 있어요)",
  "",
  "**2. 계정 연결** (각자 한 번)",
  "`/연결` → GitHub 로그인. GitHub 리뷰어로 지정되면 디스코드로 태그돼요",
  "",
  "**3. 담당자 지정**",
  "`/담당자 추가 user:@이름` PR에 GitHub 리뷰어가 없으면 담당자를 태그해요",
  "`/담당자 목록` · `/담당자 제거` · `/담당자 초기화`",
  "",
  "**알림이 가는 때**",
  "• PR 생성 / Draft 해제 → 리뷰어(없으면 담당자) 태그",
  "• 새 커밋 push → 리뷰어와 이전 리뷰 남긴 사람 태그",
  "• GitHub에서 Reviewers 지정 또는 Re-request review → 그 사람 태그",
  "• 리뷰 제출(Approve / Changes requested / Comment) → PR 작성자 태그",
  "• 리뷰 없이 오래 방치 → 리마인더",
  "• 머지 / 닫힘 → 태그 없이 알림",
].join("\n");

function installUrl(): string | undefined {
  return config.githubAppInstallUrl ?? db.getSetting("app_install_url");
}

function signInButton(url: string, label: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel(label),
  );
}

const OAUTH_NOT_READY =
  "GitHub 로그인이 아직 설정되지 않았어요. 봇 운영자에게 README의 'GitHub 로그인 설정'을 부탁하세요.";

export async function handleCommand(i: ChatInputCommandInteraction): Promise<void> {
  if (!i.inGuild()) {
    await i.reply({ content: "서버 채널에서 사용해 주세요.", flags: MessageFlags.Ephemeral });
    return;
  }
  const ephemeral = { flags: MessageFlags.Ephemeral } as const;

  switch (i.commandName) {
    case "연결": {
      const url = createSignInUrl({ kind: "link", discordId: i.user.id, discordTag: i.user.tag });
      if (!url) {
        await i.reply({ content: OAUTH_NOT_READY, ...ephemeral });
        return;
      }
      const current = db.githubLoginFor(i.user.id);
      await i.reply({
        content:
          (current ? `지금은 GitHub \`${current}\`와 연결돼 있어요.\n` : "") +
          "아래 버튼으로 GitHub에 로그인하면 본인 계정이 확인되고 연결돼요. (10분 안에 눌러 주세요)",
        components: [signInButton(url, "GitHub로 로그인해서 연결")],
        ...ephemeral,
      });
      return;
    }

    case "연결해제": {
      const removed = db.unlinkUser(i.user.id);
      await i.reply({ content: removed ? "연결을 해제했어요." : "연결된 GitHub 계정이 없어요.", ...ephemeral });
      return;
    }

    case "레포": {
      const sub = i.options.getSubcommand();
      if (sub === "목록") {
        const repos = db.reposForChannel(i.channelId);
        await i.reply(
          repos.length
            ? `📦 이 채널에 연결된 레포:\n${repos.map((r) => `• \`${r}\``).join("\n")}`
            : "이 채널에 연결된 레포가 없어요. `/레포 등록`으로 추가하세요.",
        );
        return;
      }
      const repo = parseRepo(i.options.getString("repo", true));
      if (!repo) {
        await i.reply({ content: "GitHub 레포 링크를 입력해 주세요. (예: `https://github.com/Earth-Bone/my-app`)", ...ephemeral });
        return;
      }
      if (sub === "등록") {
        if (db.reposForChannel(i.channelId).includes(repo.toLowerCase())) {
          await i.reply({ content: `\`${repo}\`는 이미 이 채널에 연결돼 있어요.`, ...ephemeral });
          return;
        }
        // Anyone could type any repo name, so require proof of write access before sending its PRs here.
        const url = createSignInUrl({
          kind: "register",
          discordId: i.user.id,
          discordTag: i.user.tag,
          repo,
          channelId: i.channelId,
          guildId: i.guildId,
        });
        if (!url) {
          await i.reply({ content: OAUTH_NOT_READY, ...ephemeral });
          return;
        }
        const install = installUrl();
        await i.reply({
          content:
            `\`${repo}\`를 연결하려면 이 레포에 **쓰기 권한**이 있는지 확인해야 해요.\n` +
            "아래 버튼으로 GitHub에 로그인하면 확인 후 바로 등록돼요. (10분 안에 눌러 주세요)" +
            (install ? `\n레포에 지본 GitHub App이 아직 없다면 먼저 👉 [설치하기](${install})` : ""),
          components: [signInButton(url, "GitHub로 권한 확인하고 등록")],
          ...ephemeral,
        });
      } else {
        const removed = db.removeRepoChannel(repo, i.channelId);
        await i.reply(removed ? `\`${repo}\` 알림을 해제했어요.` : `이 채널에 \`${repo}\`는 연결돼 있지 않아요.`);
      }
      return;
    }

    case "담당자": {
      const sub = i.options.getSubcommand();
      if (sub === "목록") {
        const ids = db.assigneesForChannel(i.channelId);
        const lines = ids.map((id) => {
          const gh = db.githubLoginFor(id);
          return `• <@${id}>${gh ? ` (GitHub \`${gh}\`)` : ""}`;
        });
        await i.reply({
          content: ids.length ? `👥 이 채널 담당자:\n${lines.join("\n")}` : "지정된 담당자가 없어요. `/담당자 추가`로 지정하세요.",
          allowedMentions: { parse: [] },
        });
        return;
      }
      if (sub === "초기화") {
        const count = db.clearAssignees(i.channelId);
        await i.reply(`담당자 ${count}명을 모두 지웠어요.`);
        return;
      }
      const user = i.options.getUser("user", true);
      if (user.bot) {
        await i.reply({ content: "봇은 담당자로 지정할 수 없어요.", ...ephemeral });
        return;
      }
      if (sub === "추가") {
        const added = db.addAssignee(i.channelId, user.id);
        await i.reply({
          content: added ? `✅ <@${user.id}>님을 담당자로 추가했어요.` : `<@${user.id}>님은 이미 담당자예요.`,
          allowedMentions: { parse: [] },
        });
      } else {
        const removed = db.removeAssignee(i.channelId, user.id);
        await i.reply({
          content: removed ? `<@${user.id}>님을 담당자에서 뺐어요.` : `<@${user.id}>님은 담당자가 아니에요.`,
          allowedMentions: { parse: [] },
        });
      }
      return;
    }

    case "도움말":
      await i.reply({ content: HELP, ...ephemeral });
      return;
  }
}
