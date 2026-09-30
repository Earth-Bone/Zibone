import {
  type ChatInputCommandInteraction,
  type Guild,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { config } from "../config.js";
import * as db from "../db.js";

const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;
const GITHUB_LOGIN_PATTERN = /^[a-z\d](?:[a-z\d-]{0,38})$/i;

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("연결")
    .setDescription("디스코드 계정과 GitHub 계정을 연결해요")
    .addStringOption((o) => o.setName("github").setDescription("GitHub 아이디 (예: octocat)").setRequired(true))
    .addUserOption((o) => o.setName("user").setDescription("다른 사람을 연결할 때만 선택 (서버 관리 권한 필요)")),

  new SlashCommandBuilder()
    .setName("연결해제")
    .setDescription("내 GitHub 계정 연결을 해제해요")
    .addUserOption((o) => o.setName("user").setDescription("다른 사람을 해제할 때만 선택 (서버 관리 권한 필요)")),

  new SlashCommandBuilder()
    .setName("레포")
    .setDescription("이 채널에서 알림 받을 GitHub 레포를 관리해요")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((s) =>
      s
        .setName("등록")
        .setDescription("이 채널에 레포 PR 알림을 연결해요")
        .addStringOption((o) => o.setName("repo").setDescription("owner/name 형식 (예: minwoo-3/my-app)").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("해제")
        .setDescription("이 채널에서 레포 알림을 끊어요")
        .addStringOption((o) => o.setName("repo").setDescription("owner/name 형식").setRequired(true)),
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
  "**1. 레포 연결** (채널 관리 권한 필요)",
  "`/레포 등록 repo:owner/name` 이 채널로 PR 알림을 받아요",
  "레포에 지본 GitHub App이 설치돼 있어야 해요 (설치 링크는 등록 답장에 있어요)",
  "",
  "**2. 계정 연결** (각자 한 번)",
  "`/연결 github:내아이디` GitHub 리뷰어 지정 시 디스코드로 태그돼요",
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

function canManageOthers(i: ChatInputCommandInteraction): boolean {
  return i.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}

export async function handleCommand(i: ChatInputCommandInteraction): Promise<void> {
  if (!i.inGuild()) {
    await i.reply({ content: "서버 채널에서 사용해 주세요.", flags: MessageFlags.Ephemeral });
    return;
  }
  const ephemeral = { flags: MessageFlags.Ephemeral } as const;

  switch (i.commandName) {
    case "연결": {
      const login = i.options.getString("github", true).trim().replace(/^@/, "");
      const target = i.options.getUser("user") ?? i.user;
      if (target.id !== i.user.id && !canManageOthers(i)) {
        await i.reply({ content: "다른 사람을 연결하려면 서버 관리 권한이 필요해요.", ...ephemeral });
        return;
      }
      if (!GITHUB_LOGIN_PATTERN.test(login)) {
        await i.reply({ content: `\`${login}\`은(는) 올바른 GitHub 아이디가 아니에요.`, ...ephemeral });
        return;
      }
      db.linkUser(target.id, login);
      await i.reply({ content: `🔗 <@${target.id}> ↔ GitHub \`${login}\` 연결했어요.`, ...ephemeral });
      return;
    }

    case "연결해제": {
      const target = i.options.getUser("user") ?? i.user;
      if (target.id !== i.user.id && !canManageOthers(i)) {
        await i.reply({ content: "다른 사람을 해제하려면 서버 관리 권한이 필요해요.", ...ephemeral });
        return;
      }
      const removed = db.unlinkUser(target.id);
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
      const repo = i.options.getString("repo", true).trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
      if (!REPO_PATTERN.test(repo)) {
        await i.reply({ content: "레포는 `owner/name` 형식으로 입력해 주세요.", ...ephemeral });
        return;
      }
      if (sub === "등록") {
        db.addRepoChannel(repo, i.channelId, i.guildId);
        await i.reply(
          `📦 \`${repo}\` PR 알림을 이 채널로 보낼게요.\n` +
            (config.githubAppInstallUrl
              ? `아직 이 레포에 지본 GitHub App을 설치하지 않았다면 👉 [설치하기](${config.githubAppInstallUrl})`
              : "GitHub 레포 Settings → Webhooks에 봇 주소가 등록돼 있는지 확인하세요."),
        );
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
