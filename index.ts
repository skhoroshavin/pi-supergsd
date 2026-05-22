import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const baseDir = dirname(fileURLToPath(import.meta.url));

export default function (pi: ExtensionAPI) {
  pi.on('resources_discover', () => {
    const skillDir = join(baseDir, 'skills');
    return { skillPaths: [skillDir] };
  });
}
