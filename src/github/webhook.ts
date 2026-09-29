import { createHmac, timingSafeEqual } from "node:crypto";
import express from "express";
import { config } from "../config.js";
import { handleEvent } from "./handlers.js";

function validSignature(rawBody: Buffer, header: string | undefined): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(
    "sha256=" + createHmac("sha256", config.githubWebhookSecret).update(rawBody).digest("hex"),
  );
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function startWebhookServer(): void {
  const app = express();

  app.get("/health", (_req, res) => {
    res.send("ok");
  });

  // Raw body is required to verify GitHub's HMAC signature.
  app.post("/github/webhook", express.raw({ type: "application/json", limit: "5mb" }), (req, res) => {
    if (!validSignature(req.body, req.header("x-hub-signature-256"))) {
      res.status(401).send("invalid signature");
      return;
    }
    const event = req.header("x-github-event") ?? "";
    if (event === "ping") {
      res.send("pong");
      return;
    }

    // Reply immediately; GitHub times out after 10 seconds.
    res.status(202).send("accepted");

    let payload: unknown;
    try {
      payload = JSON.parse(req.body.toString("utf8"));
    } catch {
      console.warn("Webhook body is not JSON; set the webhook content type to application/json");
      return;
    }
    handleEvent(event, payload).catch((err) => console.error(`Failed to handle ${event} event:`, err));
  });

  app.listen(config.port, () => {
    console.log(`Webhook server listening on :${config.port} (POST /github/webhook)`);
  });
}
