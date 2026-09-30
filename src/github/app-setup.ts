import { randomBytes } from "node:crypto";
import { Router, type Request } from "express";
import * as db from "../db.js";

/*
 * One-click GitHub App creation using GitHub's app manifest flow:
 *   GET /setup            -> form that posts a prefilled manifest to GitHub
 *   GitHub                -> user confirms, GitHub redirects back with ?code
 *   GET /setup/callback   -> exchange code for the app's webhook secret, then send user to the install page
 * Only one app can be created this way, so a stranger cannot replace the webhook secret later.
 */

const STATE_TTL_MS = 30 * 60 * 1000;
const pendingStates = new Map<string, number>();

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function page(title: string, body: string): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
body{font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:48px auto;padding:0 16px;line-height:1.6;color:#1f2328}
button,a.button{display:inline-block;background:#2da44e;color:#fff;border:0;border-radius:6px;padding:10px 18px;font-size:16px;text-decoration:none;cursor:pointer}
input{padding:8px;font-size:15px;border:1px solid #d0d7de;border-radius:6px;width:100%;box-sizing:border-box;margin:4px 0 16px}
code{background:#f6f8fa;padding:2px 6px;border-radius:4px}
</style></head><body>${body}</body></html>`;
}

function baseUrl(req: Request): string {
  return `${req.protocol}://${req.get("host")}`;
}

function installUrlFor(slug: string): string {
  return `https://github.com/apps/${slug}/installations/new`;
}

export function setupRouter(): Router {
  const router = Router();

  router.get("/setup", (req, res) => {
    const slug = db.getSetting("app_slug");
    if (slug) {
      res.send(
        page(
          "지본 GitHub App",
          `<h1>🌏 지본 GitHub App이 이미 있어요</h1>
<p>레포에 설치하려면 아래 버튼을 누르세요.</p>
<p><a class="button" href="${installUrlFor(slug)}">레포에 설치하기</a></p>`,
        ),
      );
      return;
    }

    const org = typeof req.query.org === "string" ? req.query.org.trim() : "";
    const name = typeof req.query.name === "string" && req.query.name.trim() ? req.query.name.trim() : "Zibone";
    const state = randomBytes(16).toString("hex");
    pendingStates.set(state, Date.now());

    const base = baseUrl(req);
    const manifest = {
      name,
      url: "https://github.com/minwoo-3/Zibone",
      description: "PR이 올라오면 디스코드에서 리뷰어를 태그해 주는 봇",
      hook_attributes: { url: `${base}/github/webhook`, active: true },
      redirect_url: `${base}/setup/callback`,
      public: true,
      default_permissions: { pull_requests: "read", metadata: "read" },
      default_events: ["pull_request", "pull_request_review"],
    };
    const action = org
      ? `https://github.com/organizations/${encodeURIComponent(org)}/settings/apps/new?state=${state}`
      : `https://github.com/settings/apps/new?state=${state}`;

    res.send(
      page(
        "지본 GitHub App 만들기",
        `<h1>🌏 지본 GitHub App 만들기</h1>
<p>아래 버튼을 누르면 GitHub에서 App 생성 화면이 열려요. 설정은 모두 채워져 있으니 <b>Create GitHub App</b>만 누르면 돼요.</p>
<form method="get" action="/setup">
  <label>App 이름 (이미 쓰이는 이름이면 바꿔 주세요)</label>
  <input name="name" value="${escapeHtml(name)}">
  <label>올가 소유로 만들려면 올가 이름 (비우면 내 계정 소유)</label>
  <input name="org" value="${escapeHtml(org)}" placeholder="예: APEX-Moa">
  <button type="submit" style="background:#6e7781">이름/소유자 적용</button>
</form>
<hr style="margin:24px 0">
<form method="post" action="${escapeHtml(action)}">
  <input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}">
  <button type="submit">GitHub에서 "${escapeHtml(name)}" App 만들기</button>
</form>
<p style="color:#656d76;font-size:14px">Webhook 주소: <code>${escapeHtml(manifest.hook_attributes.url)}</code></p>`,
      ),
    );
  });

  router.get("/setup/callback", async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const issuedAt = pendingStates.get(state);
    pendingStates.delete(state);

    if (db.getSetting("app_slug")) {
      res.redirect("/setup");
      return;
    }
    if (!code || !issuedAt || Date.now() - issuedAt > STATE_TTL_MS) {
      res.status(400).send(page("오류", `<p>요청이 만료됐어요. <a href="/setup">처음부터 다시</a> 해 주세요.</p>`));
      return;
    }

    const response = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
      method: "POST",
      headers: { Accept: "application/vnd.github+json", "User-Agent": "zibone-bot" },
    });
    if (!response.ok) {
      console.error("GitHub App manifest conversion failed:", response.status, await response.text());
      res.status(502).send(page("오류", `<p>GitHub App 생성 확인에 실패했어요. <a href="/setup">다시 시도</a>해 주세요.</p>`));
      return;
    }
    const app = (await response.json()) as { slug: string; name: string; webhook_secret: string; html_url: string };

    db.setSetting("app_slug", app.slug);
    db.setSetting("app_webhook_secret", app.webhook_secret);
    db.setSetting("app_install_url", installUrlFor(app.slug));
    console.log(`GitHub App "${app.name}" created: ${app.html_url}`);

    res.redirect(installUrlFor(app.slug));
  });

  return router;
}
