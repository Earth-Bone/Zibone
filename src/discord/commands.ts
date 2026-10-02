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
const LOGIN_PATTERN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

/** Accepts a GitHub username, @username, or profile link. */
function parseLogin(input: string): string | null {
  const login = input
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "")
    .replace(/^@/, "")
    .split(/[/?#]/)[0];
  return LOGIN_PATTERN.test(login) ? login : null;
}

/** Public repos are visible to anyone anyway, so they can be registered without signing in. */
async function publicRepoName(repo: string): Promise<string | undefined> {
  const res = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "zibone-bot" },
  }).catch(() => undefined);
  if (!res?.ok) return undefined;
  const body = (await res.json().catch(() => ({}))) as { full_name?: string; private?: boolean };
  return body.private === false ? body.full_name : undefined;
}

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
    .setDescription("디스코드 사람과 GitHub 아이디를 연결해요 (GitHub 리뷰어 태그용)")
    .addStringOption((o) => o.setName("github").setDescription("GitHub 아이디 (예: minsu)").setRequired(true))
    .addUserOption((o) => o.setName("대상").setDescription("연결할 사람 (비우면 나)")),

  new SlashCommandBuilder()
    .setName("연결해제")
    .setDescription("GitHub 아이디 연결을 해제해요")
    .addUserOption((o) => o.setName("대상").setDescription("해제할 사람 (비우면 나)")),

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
    .setDescription("이 채널에서 PR 알림 때 태그할 사람이나 역할을 관리해요")
    .addSubcommand((s) =>
      s
        .setName("추가")
        .setDescription("태그할 사람이나 역할을 추가해요")
        .addMentionableOption((o) => o.setName("대상").setDescription("추가할 사람 또는 역할").setRequired(true))
        .addStringOption((o) => o.setName("github").setDescription("사람의 GitHub 아이디 (선택, 리뷰어 태그용)")),
    )
    .addSubcommand((s) =>
      s
        .setName("제거")
        .setDescription("태그 대상에서 빼요")
        .addMentionableOption((o) => o.setName("대상").setDescription("뺄 사람 또는 역할").setRequired(true)),
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
  "`/레포 등록 repo:https://github.com/owner/name` → 공개 레포는 바로 등록, 비공개 레포는 GitHub 로그인으로 쓰기 권한을 확인해요",
  "레포에 지본 GitHub App이 설치돼 있어야 해요 (설치 링크는 등록 답장에 있어요)",
  "",
  "**2. 담당자 지정** (한 사람이 팀 전체를 등록해도 돼요)",
  "`/담당자 추가 대상:@민수 github:minsu` PR에 GitHub 리뷰어가 없으면 담당자를 태그하고, GitHub에서 minsu가 리뷰어로 지정돼도 @민수를 태그해요",
  "`대상:@역할`로 역할도 지정할 수 있어요",
  "`/담당자 목록` · `/담당자 제거` · `/담당자 초기화`",
  "",
  "**3. GitHub 아이디만 연결** (담당자는 아니지만 리뷰어로 지정될 사람)",
  "`/연결 github:minsu 대상:@민수` · `/연결해제 대상:@민수`",
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
      const login = parseLogin(i.options.getString("github", true));
      const target = i.options.getUser("대상") ?? i.user;
      if (!login) {
        await i.reply({ content: "GitHub 아이디를 확인해 주세요. (예: `minsu`)", ...ephemeral });
        return;
      }
      if (target.bot) {
        await i.reply({ content: "봇은 연결할 수 없어요.", ...ephemeral });
        return;
      }
      db.linkUser(target.id, login);
      await i.reply({
        content: `🔗 <@${target.id}> ↔ GitHub \`${login}\` 연결했어요.`,
        allowedMentions: { parse: [] },
      });
      return;
    }

    case "연결해제": {
      const target = i.options.getUser("대상") ?? i.user;
      const removed = db.unlinkUser(target.id);
      await i.reply({
        content: removed ? `<@${target.id}>의 GitHub 연결을 해제했어요.` : `<@${target.id}>은 연결된 GitHub 아이디가 없어요.`,
        allowedMentions: { parse: [] },
      });
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
        const publicName = await publicRepoName(repo);
        if (publicName) {
          db.addRepoChannel(publicName, i.channelId, i.guildId);
          const install = installUrl();
          await i.reply(
            `📦 \`${publicName}\` PR 알림을 이 채널에 연결했어요.` +
              (install ? `\n레포에 지본 GitHub App이 아직 없다면 👉 [설치하기](<${install}>)` : ""),
          );
          return;
        }
        // Private repo names could be guessed, so require proof of write access before sending its PRs here.
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
            `\`${repo}\`는 비공개 레포라 **쓰기 권한**이 있는지 확인해야 해요.\n` +
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
        const { users, roles } = db.assigneesForChannel(i.channelId);
        const lines = [
          ...roles.map((id) => `• <@&${id}> (역할)`),
          ...users.map((id) => {
            const gh = db.githubLoginFor(id);
            return `• <@${id}>${gh ? ` (GitHub \`${gh}\`)` : ""}`;
          }),
        ];
        await i.reply({
          content: lines.length ? `👥 이 채널 담당자:\n${lines.join("\n")}` : "지정된 담당자가 없어요. `/담당자 추가`로 지정하세요.",
          allowedMentions: { parse: [] },
        });
        return;
      }
      if (sub === "초기화") {
        const count = db.clearAssignees(i.channelId);
        await i.reply(`담당자 ${count}개를 모두 지웠어요.`);
        return;
      }
      const role = i.options.getRole("대상");
      const user = role ? null : i.options.getUser("대상");
      if (!role && !user) {
        await i.reply({ content: "사람이나 역할을 골라 주세요.", ...ephemeral });
        return;
      }
      if (user?.bot) {
        await i.reply({ content: "봇은 담당자로 지정할 수 없어요.", ...ephemeral });
        return;
      }
      if (role?.id === i.guildId) {
        await i.reply({ content: "@everyone은 담당자로 지정할 수 없어요.", ...ephemeral });
        return;
      }
      const id = role ? role.id : user!.id;
      const name = role ? `<@&${id}> 역할` : `<@${id}>님`;
      if (sub === "추가") {
        const githubInput = i.options.getString("github");
        const login = githubInput ? parseLogin(githubInput) : null;
        if (githubInput && (role || !login)) {
          await i.reply({
            content: role ? "역할에는 GitHub 아이디를 붙일 수 없어요." : "GitHub 아이디를 확인해 주세요. (예: `minsu`)",
            ...ephemeral,
          });
          return;
        }
        const added = db.addAssignee(i.channelId, id, role ? "role" : "user");
        if (login) db.linkUser(id, login);
        const linked = login ? ` (GitHub \`${login}\` 연결)` : "";
        await i.reply({
          content: added ? `✅ ${name}을 담당자로 추가했어요.${linked}` : `${name}은 이미 담당자예요.${linked}`,
          allowedMentions: { parse: [] },
        });
      } else {
        const removed = db.removeAssignee(i.channelId, id);
        await i.reply({
          content: removed ? `${name}을 담당자에서 뺐어요.` : `${name}은 담당자가 아니에요.`,
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
