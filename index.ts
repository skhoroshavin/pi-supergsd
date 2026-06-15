import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  cmdAbortTask,
  cmdAuto,
  cmdDiscardTask,
  cmdFinishTask,
  toolPushTask,
  cmdStartTask,
  rendererTaskResult,
  setSkillsFromEvent,
  setModelRegistry,
  updateTaskStatus,
} from "./src/index.js";

export default function register(pi: ExtensionAPI): void {
  pi.registerTool(toolPushTask(pi));
  pi.registerCommand("start-task", cmdStartTask(pi));
  pi.registerCommand("discard-task", cmdDiscardTask(pi));
  pi.registerCommand("finish-task", cmdFinishTask(pi));
  pi.registerCommand("abort-task", cmdAbortTask(pi));
  pi.registerCommand("auto", cmdAuto(pi));

  pi.registerMessageRenderer("task-result", rendererTaskResult);

  pi.on("before_agent_start", async (event) => {
    if (event.systemPromptOptions.skills?.length) {
      setSkillsFromEvent(event.systemPromptOptions.skills);
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    setModelRegistry(ctx.modelRegistry);
    updateTaskStatus(ctx.sessionManager, ctx.ui.setStatus.bind(ctx.ui), ctx.ui.theme);
  });

  pi.on("turn_end", async (_event, ctx) => {
    updateTaskStatus(ctx.sessionManager, ctx.ui.setStatus.bind(ctx.ui), ctx.ui.theme);
  });

  pi.on("session_tree", async (_event, ctx) => {
    updateTaskStatus(ctx.sessionManager, ctx.ui.setStatus.bind(ctx.ui), ctx.ui.theme);
  });
}
