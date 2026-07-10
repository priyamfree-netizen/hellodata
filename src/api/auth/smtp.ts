import type { Env } from "./_utils";

type SmtpModule = typeof import("cloudflare:sockets");
type CloudflareSmtpSocket = import("cloudflare:sockets").Socket;
type SmtpSocketLike = {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close: () => Promise<void>;
  startTls?: () => SmtpSocketLike | Promise<SmtpSocketLike>;
};

export type SmtpEmail = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  replyTo?: string;
  secureMode: "ssl" | "starttls" | "plain";
  allowInsecure: boolean;
  heloDomain: string;
};

function runtimeEnv(): Record<string, unknown> {
  const cfEnv = (globalThis as { __cf_env__?: Record<string, unknown> }).__cf_env__;
  const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env;
  const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return { ...(viteEnv ?? {}), ...(processEnv ?? {}), ...(cfEnv ?? {}) };
}

function envVar(env: Env, key: keyof Env): string | undefined {
  const direct = env?.[key];
  if (typeof direct === "string" && direct.length > 0) return direct;
  const fallback = runtimeEnv()[key];
  return typeof fallback === "string" && fallback.length > 0 ? fallback : undefined;
}

function getSmtpConfig(env: Env): SmtpConfig | null {
  const host = envVar(env, "SMTP_HOST");
  const user = envVar(env, "SMTP_USER");
  const pass = envVar(env, "SMTP_PASS");
  const appUrl = envVar(env, "VITE_APP_URL") ?? "http://localhost:8080";

  if (!host && !user && !pass) return null;
  if (!host || !user || !pass) {
    throw new Error("SMTP is partially configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS.");
  }

  const port = Number(envVar(env, "SMTP_PORT") ?? "587");
  const secureSetting = (envVar(env, "SMTP_SECURE") ?? "auto").toLowerCase();
  const secureMode =
    secureSetting === "true" || secureSetting === "ssl" || port === 465
      ? "ssl"
      : secureSetting === "false" || secureSetting === "plain"
        ? "plain"
        : "starttls";

  return {
    host,
    port,
    user,
    pass,
    from: envVar(env, "SMTP_FROM") ?? `HelloData <noreply@${new URL(appUrl).hostname}>`,
    replyTo: envVar(env, "SMTP_REPLY_TO"),
    secureMode,
    allowInsecure: envVar(env, "SMTP_ALLOW_INSECURE") === "true",
    heloDomain: envVar(env, "SMTP_HELO_DOMAIN") ?? new URL(appUrl).hostname,
  };
}

export async function sendSmtpEmail(env: Env, email: SmtpEmail): Promise<void> {
  const config = getSmtpConfig(env);
  if (!config) {
    console.log(`[email] To: ${email.to}\nSubject: ${email.subject}\n${email.text ?? email.html}`);
    return;
  }

  if (config.port === 25) {
    throw new Error("Cloudflare Workers cannot send SMTP on port 25. Use 465, 587, or 2525.");
  }

  const socket = await connectSmtpSocket(config);

  const client = new SmtpClient(socket);
  try {
    await client.expect([220]);
    const ehlo = await client.command(`EHLO ${config.heloDomain}`, [250]);

    if (config.secureMode === "starttls") {
      if (!ehlo.includes("STARTTLS")) {
        if (!config.allowInsecure) throw new Error("SMTP server does not advertise STARTTLS.");
      } else {
        await client.startTls();
        await client.command(`EHLO ${config.heloDomain}`, [250]);
      }
    }

    await client.command(
      `AUTH PLAIN ${base64(`\u0000${config.user}\u0000${config.pass}`)}`,
      [235, 503],
    );
    await client.command(`MAIL FROM:<${extractAddress(config.from)}>`, [250]);
    await client.command(`RCPT TO:<${extractAddress(email.to)}>`, [250, 251]);
    await client.command("DATA", [354]);
    await client.writeData(buildMimeMessage(config, email));
    await client.expect([250]);
    await client.command("QUIT", [221]);
  } finally {
    await client.close();
  }
}

class SmtpClient {
  private decoder = new TextDecoder();
  private encoder = new TextEncoder();
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private buffer = "";

  constructor(private socket: SmtpSocketLike) {
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
  }

  async command(command: string, codes: number[]): Promise<string> {
    await this.write(`${command}\r\n`);
    return this.expect(codes);
  }

  async expect(codes: number[]): Promise<string> {
    const lines: string[] = [];
    while (true) {
      const line = await this.readLine();
      lines.push(line);
      if (/^\d{3} /.test(line)) break;
    }

    const response = lines.join("\n");
    const code = Number(response.slice(0, 3));
    if (!codes.includes(code))
      throw new Error(`SMTP expected ${codes.join("/")} but got ${response}`);
    return response;
  }

  async startTls(): Promise<void> {
    await this.command("STARTTLS", [220]);
    if (!this.socket.startTls) throw new Error("SMTP transport does not support STARTTLS.");
    this.reader.releaseLock();
    this.writer.releaseLock();
    this.socket = await this.socket.startTls();
    this.reader = this.socket.readable.getReader();
    this.writer = this.socket.writable.getWriter();
    this.buffer = "";
  }

  async writeData(message: string): Promise<void> {
    await this.write(`${dotStuff(message)}\r\n.\r\n`);
  }

  async close(): Promise<void> {
    this.reader.releaseLock();
    this.writer.releaseLock();
    await this.socket.close().catch(() => {});
  }

  private async write(value: string): Promise<void> {
    await this.writer.write(this.encoder.encode(value));
  }

  private async readLine(): Promise<string> {
    while (!this.buffer.includes("\n")) {
      const { value, done } = await this.reader.read();
      if (done) throw new Error("SMTP connection closed unexpectedly.");
      this.buffer += this.decoder.decode(value, { stream: true });
    }

    const index = this.buffer.indexOf("\n");
    const line = this.buffer.slice(0, index).replace(/\r$/, "");
    this.buffer = this.buffer.slice(index + 1);
    return line;
  }
}

async function connectSmtpSocket(config: SmtpConfig): Promise<SmtpSocketLike> {
  try {
    const { connect } = (await import("cloudflare:sockets")) as SmtpModule;
    return connect(
      { hostname: config.host, port: config.port },
      {
        secureTransport:
          config.secureMode === "ssl"
            ? "on"
            : config.secureMode === "starttls"
              ? "starttls"
              : "off",
      },
    ) as CloudflareSmtpSocket;
  } catch (error) {
    if (!isCloudflareSocketsUnavailable(error)) throw error;
    return connectNodeSmtpSocket(config);
  }
}

function isCloudflareSocketsUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("cloudflare:sockets") || message.includes("ERR_MODULE_NOT_FOUND");
}

async function connectNodeSmtpSocket(config: SmtpConfig): Promise<SmtpSocketLike> {
  type NodeSocket = import("node:net").Socket;
  const net = await import("node:net");
  const tls = await import("node:tls");
  const { Readable, Writable } = await import("node:stream");

  async function wrap(
    socket: NodeSocket,
    readyEvent: "connect" | "secureConnect",
  ): Promise<SmtpSocketLike> {
    await new Promise<void>((resolve, reject) => {
      if (socket.readyState === "open") {
        resolve();
        return;
      }
      socket.once(readyEvent, () => resolve());
      socket.once("error", reject);
    });

    return {
      readable: Readable.toWeb(socket) as ReadableStream<Uint8Array>,
      writable: Writable.toWeb(socket) as WritableStream<Uint8Array>,
      close: async () => {
        await new Promise<void>((resolve) => socket.end(() => resolve()));
      },
      startTls: async () => {
        const tlsSocket = tls.connect({ socket, servername: config.host });
        return wrap(tlsSocket, "secureConnect");
      },
    };
  }

  if (config.secureMode === "ssl") {
    return wrap(
      tls.connect({ host: config.host, port: config.port, servername: config.host }),
      "secureConnect",
    );
  }

  return wrap(net.connect({ host: config.host, port: config.port }), "connect");
}

function buildMimeMessage(config: SmtpConfig, email: SmtpEmail): string {
  const boundary = `billsos-${crypto.randomUUID()}`;
  const text = email.text ?? htmlToText(email.html);

  return [
    `From: ${sanitizeHeader(config.from)}`,
    `To: ${sanitizeHeader(email.to)}`,
    `Subject: ${sanitizeHeader(email.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${config.heloDomain}>`,
    "MIME-Version: 1.0",
    ...(config.replyTo ? [`Reply-To: ${sanitizeHeader(config.replyTo)}`] : []),
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    email.html,
    "",
    `--${boundary}--`,
  ].join("\r\n");
}

function base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function dotStuff(message: string): string {
  return message.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
}

function extractAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return sanitizeHeader(match?.[1] ?? from).trim();
}

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
