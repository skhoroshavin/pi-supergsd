import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import registerTaskCommands from './src/index.js';

export default function register(pi: ExtensionAPI): void {
  registerTaskCommands(pi);
}
