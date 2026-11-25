import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import { z } from "zod";

export type ReplyTarget =
  | { kind: "channel"; channelId: string }
  | { kind: "thread"; channelId: string; threadTs: string }
  | { kind: "message"; channelId: string; threadTs: string; sourceTs: string };

export interface SlackFileUpload {
  filename: string;
  content: Buffer;
  title?: string;
  initialComment?: string;
}

export interface SlackTransport {
  postMessage(target: ReplyTarget, text: string): Promise<{ ts: string }>;
  uploadFile(target: ReplyTarget, file: SlackFileUpload): Promise<void>;
  addReaction(channelId: string, messageTs: string, emoji: string): Promise<void>;
}

export interface IncomingMessage {
  channelId: string;
  userId: string;
  text: string;
  ts: string;
  threadTs: string | undefined;
}

const userMessageSchema = z.object({
  type: z.literal("message"),
  channel: z.string(),
  user: z.string(),
  text: z.string(),
  ts: z.string(),
  thread_ts: z.string().optional(),
  subtype: z.undefined(),
  bot_id: z.undefined(),
});

export interface SlackOptions {
  appToken: string;
  botToken: string;
  onMessage(message: IncomingMessage): void;
}

export interface SlackConnection {
  transport: SlackTransport;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createSlack({ appToken, botToken, onMessage }: SlackOptions): SlackConnection {
  const socket = new SocketModeClient({ appToken });
  const web = new WebClient(botToken);

  socket.on("message", async ({ event, ack }: { event: unknown; ack: () => Promise<void> }) => {
    await ack();

    const message = userMessageSchema.safeParse(event);

    if (!message.success) {
      return;
    }

    onMessage({
      channelId: message.data.channel,
      userId: message.data.user,
      text: message.data.text,
      ts: message.data.ts,
      threadTs: message.data.thread_ts,
    });
  });

  // TODO: Handle app_mention, reaction, and interactive payloads once profiles need them.

  return {
    transport: {
      async postMessage(target, text) {
        const response = await web.chat.postMessage({
          channel: target.channelId,
          text,
          ...(target.kind !== "channel" && { thread_ts: target.threadTs }),
        });

        if (response.ts === undefined) {
          throw new Error(`Slack did not return a message ts for channel ${target.channelId}`);
        }

        return { ts: response.ts };
      },
      async uploadFile(target, file) {
        const base = {
          channel_id: target.channelId,
          filename: file.filename,
          file: file.content,
          ...(file.title !== undefined ? { title: file.title } : {}),
          ...(file.initialComment !== undefined ? { initial_comment: file.initialComment } : {}),
        };

        if (target.kind !== "channel") {
          await web.filesUploadV2({ ...base, thread_ts: target.threadTs });
        } else {
          await web.filesUploadV2(base);
        }
      },
      async addReaction(channelId, messageTs, emoji) {
        await web.reactions.add({ channel: channelId, timestamp: messageTs, name: emoji });
      },
    },
    start: async () => {
      await socket.start();
    },
    stop: () => socket.disconnect(),
  };
}
