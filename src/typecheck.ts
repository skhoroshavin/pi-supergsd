import { cmdAuto, toolPushTask, updateTaskStatus } from './index.js';

void ({
  appendEntry() {},
  sendUserMessage() {},
  sendMessage() {},
  on() {},
} satisfies Parameters<typeof cmdAuto>[0]);

void ({
  appendEntry() {},
} satisfies Parameters<typeof toolPushTask>[0]);

void ({
  fg: (_key: string, text: string) => text,
} satisfies Parameters<typeof updateTaskStatus>[2]);
