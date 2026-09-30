// Minimal HTML shell for the few pages the bot serves (setup, sign-in results).

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function page(title: string, body: string): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
body{font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:48px auto;padding:0 16px;line-height:1.6;color:#1f2328}
button,a.button{display:inline-block;background:#2da44e;color:#fff;border:0;border-radius:6px;padding:10px 18px;font-size:16px;text-decoration:none;cursor:pointer}
input{padding:8px;font-size:15px;border:1px solid #d0d7de;border-radius:6px;width:100%;box-sizing:border-box;margin:4px 0 16px}
code{background:#f6f8fa;padding:2px 6px;border-radius:4px}
</style></head><body>${body}</body></html>`;
}
