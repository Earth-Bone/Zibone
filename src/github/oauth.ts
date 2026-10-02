import { randomBytes } from "node:crypto";
import { EmbedBuilder } from "discord.js";
import { Router } from "express";
import { config } from "../config.js";
import * as db from "../db.js";
import { send } from "../discord/client.js";
import { escapeHtml as escape, page } from "./pages.js";

/*
 * GitHub sign-in used by /레포 등록 for private repos: the Discord user proves they can push to the repo
 * (and that the app is installed there). Public repos and account links need no sign-in.
 * The GitHub token is used once inside the callback and never stored.
 */

const PENDING_TTL_MS = 10 * 60 * 1000;
const CALLBACK_PATH = "/auth/github/callback";

type PendingAction = {
  kind: "register";
  discordId: string;
  discordTag: string;
  repo: string;
  channelId: string;
  guildId: string;
};

const pending = new Map<string, PendingAction & { createdAt: number }>();

export function oauthCredentials(): { clientId: string; clientSecret: string } | undefined {
  const clientId = config.githubClientId ?? db.getSetting("app_client_id");
  const clientSecret = config.githubClientSecret ?? db.getSetting("app_client_secret");
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

export function callbackUrl(base: string): string {
  return `${base}${CALLBACK_PATH}`;
}

/** Returns a GitHub sign-in URL that completes `action` once the user approves, or undefined if OAuth is not set up. */
export function createSignInUrl(action: PendingAction): string | undefined {
  const creds = oauthCredentials();
  if (!creds || !config.publicUrl) return undefined;
  const now = Date.now();
  for (const [key, value] of pending) if (now - value.createdAt > PENDING_TTL_MS) pending.delete(key);
  const state = randomBytes(16).toString("hex");
  pending.set(state, { ...action, createdAt: now });
  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: callbackUrl(config.publicUrl),
    state,
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

async function github<T>(path: string, token: string): Promise<{ status: number; body: T }> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "zibone-bot",
    },
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as T };
}

const done = (title: string, message: string) =>
  page(title, `<h1>${title}</h1><p>${message}</p><p>이 창은 닫고 디스코드로 돌아가세요.</p>`);

export function oauthRouter(): Router {
  const router = Router();

  router.get(CALLBACK_PATH, async (req, res) => {
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const action = pending.get(state);
    pending.delete(state);
    const creds = oauthCredentials();

    if (!action || Date.now() - action.createdAt > PENDING_TTL_MS || !code || !creds) {
      res.status(400).send(done("⌛ 링크가 만료됐어요", "디스코드에서 명령어를 다시 실행해 주세요."));
      return;
    }

    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "zibone-bot" },
      body: JSON.stringify({ client_id: creds.clientId, client_secret: creds.clientSecret, code }),
    });
    const { access_token: token } = (await tokenRes.json().catch(() => ({}))) as { access_token?: string };
    if (!token) {
      res.status(502).send(done("❌ GitHub 인증 실패", "잠시 후 다시 시도해 주세요."));
      return;
    }

    const user = await github<{ login?: string }>("/user", token);
    const login = user.body.login;
    if (!login) {
      res.status(502).send(done("❌ GitHub 인증 실패", "GitHub 계정 정보를 가져오지 못했어요."));
      return;
    }

    // Signing in proves the GitHub identity, so link the accounts too.
    db.linkUser(action.discordId, login);

    // A GitHub App user token only sees repos where the app is installed, so 404 means "not installed or no access".
    const repo = await github<{ full_name?: string; permissions?: { push?: boolean; admin?: boolean } }>(
      `/repos/${action.repo}`,
      token,
    );
    if (repo.status === 404 || !repo.body.full_name) {
      const install = db.getSetting("app_install_url") ?? config.githubAppInstallUrl;
      res.status(403).send(
        page(
          "레포를 찾을 수 없어요",
          `<h1>🔒 ${escape(action.repo)}에 접근할 수 없어요</h1>
<p>둘 중 하나예요.</p>
<ul><li>이 레포에 지본 GitHub App이 설치되지 않았어요.${install ? ` <a href="${install}">설치하기</a>` : ""}</li>
<li>GitHub <b>${escape(login)}</b> 계정이 이 레포에 접근 권한이 없어요.</li></ul>
<p>해결한 뒤 디스코드에서 <code>/레포 등록</code>을 다시 실행해 주세요.</p>`,
        ),
      );
      return;
    }
    if (!repo.body.permissions?.push && !repo.body.permissions?.admin) {
      res
        .status(403)
        .send(done("🔒 권한이 부족해요", `<b>${escape(login)}</b> 계정은 이 레포에 쓰기(push) 권한이 없어요. 레포 멤버에게 등록을 부탁하세요.`));
      return;
    }

    const repoName = repo.body.full_name;
    db.addRepoChannel(repoName, action.channelId, action.guildId);
    console.log(`Registered ${repoName} in #${action.channelId} by ${action.discordTag} (GitHub ${login})`);
    await send({
      channelId: action.channelId,
      mentions: [],
      headline: `📦 <@${action.discordId}>님이 \`${repoName}\` PR 알림을 이 채널에 연결했어요.`,
      embed: new EmbedBuilder().setColor(0x2da44e).setDescription(`GitHub \`${login}\` 계정으로 권한을 확인했어요.`),
    }).catch((err) => console.error("Could not announce registration:", err));

    res.send(done("📦 등록 완료", `<b>${escape(repoName)}</b> PR 알림을 디스코드 채널로 보낼게요.`));
  });

  return router;
}

