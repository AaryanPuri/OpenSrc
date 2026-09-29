/**
 * Outgoing email behind one small interface: Resend in production (plain fetch, so it
 * runs on Workers and Node), the console for local development and tests.
 */
import type { Env } from "../types.js";

export const REPLY_TO = "hello@opensrc.studio";

export interface MailMessage {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  /** Extra headers, e.g. List-Unsubscribe. */
  headers?: Record<string, string>;
}

export interface MailProvider {
  readonly name: string;
  send(msg: MailMessage): Promise<{ id?: string }>;
}

export class MailError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MailError";
  }
}

/** Resend's REST API (https://resend.com/docs/api-reference/emails/send-email). */
export class ResendProvider implements MailProvider {
  readonly name = "resend";
  constructor(
    private apiKey: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async send(msg: MailMessage): Promise<{ id?: string }> {
    const res = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: msg.from,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
        ...(msg.headers ? { headers: msg.headers } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new MailError(`Resend ${res.status}: ${body.slice(0, 300)}`, res.status);
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { id: data.id };
  }
}

/** Logs each email (subject, recipient, links) and keeps it in `outbox`. For development and tests. */
export class ConsoleProvider implements MailProvider {
  readonly name = "console";
  readonly outbox: MailMessage[] = [];
  constructor(private log: (msg: string) => void = console.log) {}

  async send(msg: MailMessage): Promise<{ id?: string }> {
    this.outbox.push(msg);
    const links = [...msg.text.matchAll(/https?:\/\/\S+/g)].map((m) => m[0]);
    this.log(
      [
        `[mail] to=${msg.to} from=${msg.from} subject=${JSON.stringify(msg.subject)}`,
        ...links.map((l) => `  ${l}`),
      ].join("\n"),
    );
    return { id: `console-${this.outbox.length}` };
  }
}

/** Resend when RESEND_API_KEY and NEWSLETTER_FROM are set, the console when MAIL_PROVIDER=console, else none. */
export function mailFromEnv(env: Env, fetchImpl?: typeof fetch): MailProvider | null {
  if (env.RESEND_API_KEY && env.NEWSLETTER_FROM) return new ResendProvider(env.RESEND_API_KEY, fetchImpl);
  if (env.MAIL_PROVIDER === "console") return new ConsoleProvider();
  return null;
}

/** The From address: NEWSLETTER_FROM, or a placeholder for console mail. */
export const mailFrom = (env: Env) => env.NEWSLETTER_FROM || "OpenSrc <digest@opensrc.studio>";
