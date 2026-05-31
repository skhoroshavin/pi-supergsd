import type {
  ExtensionUIContext,
  Theme,
} from "@earendil-works/pi-coding-agent";

export class TestUI {
  status: string | undefined;
  readonly notificationLog: TestNotification[] = [];
  readonly taskStatusHistory: Array<string | undefined> = [];

  readonly theme = {
    fg: (_key: string, text: string) => text,
    bg: (_key: string, text: string) => text,
    bold: (text: string) => text,
  } satisfies Pick<Theme, "fg" | "bg" | "bold">;

  readonly context: ExtensionUIContext = {
    notify: (message: string, level?: "error" | "warning" | "info") => {
      this.notificationLog.push({ message, level });
    },
    setStatus: (key: string, value: string | undefined) => {
      if (key !== "task") return;
      this.status = value;
      this.taskStatusHistory.push(value);
    },
    theme: this.theme,
  } as ExtensionUIContext;
}

export type TestNotification = {
  message: string;
  level: "error" | "warning" | "info" | undefined;
};
