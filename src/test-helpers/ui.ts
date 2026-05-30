import type { ExtensionUIContext, Theme } from '@earendil-works/pi-coding-agent';

export class TestUI {
  private readonly notificationLog: string[] = [];
  private readonly taskStatusHistory: Array<string | undefined> = [];
  private taskStatus: string | undefined;

  readonly theme = {
    fg: (_key: string, text: string) => text,
    bg: (_key: string, text: string) => text,
    bold: (text: string) => text,
  } satisfies Pick<Theme, 'fg' | 'bg' | 'bold'>;

  readonly context: ExtensionUIContext = {
    notify: (message: string) => {
      this.notificationLog.push(message);
    },
    setStatus: (key: string, value: string | undefined) => {
      if (key !== 'task') return;
      this.taskStatus = value;
      this.taskStatusHistory.push(value);
    },
    theme: this.theme,
  } as ExtensionUIContext;

  getStatus(): string | undefined {
    return this.taskStatus;
  }

  notifications(): readonly string[] {
    return this.notificationLog;
  }

  taskStatuses(): ReadonlyArray<string | undefined> {
    return this.taskStatusHistory;
  }
}
