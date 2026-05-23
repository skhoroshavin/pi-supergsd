import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')) as {
  name?: string;
  description?: string;
  license?: string;
  homepage?: string;
  keywords?: string[];
  files?: string[];
  scripts?: Record<string, string>;
  repository?: { type?: string; url?: string };
  bugs?: { url?: string };
  pi?: { extensions?: string[] };
  peerDependencies?: Record<string, string>;
};

test('package.json exposes npm and Pi metadata', () => {
  assert.equal(packageJson.name, 'pi-supergsd');
  assert.equal(packageJson.description, 'Curated, patched Superpowers skills packaged for Pi');
  assert.equal(packageJson.license, 'MIT');
  assert.deepEqual(packageJson.keywords, [
    'pi-package',
    'pi',
    'skills',
    'superpowers',
    'coding-agent',
  ]);
  assert.deepEqual(packageJson.files, ['index.ts', 'skills', 'README.md', 'LICENSE']);
  assert.equal(packageJson.repository?.type, 'git');
  assert.equal(packageJson.repository?.url, 'git+https://github.com/skhoroshavin/pi-supergsd.git');
  assert.equal(packageJson.homepage, 'https://github.com/skhoroshavin/pi-supergsd#readme');
  assert.equal(packageJson.bugs?.url, 'https://github.com/skhoroshavin/pi-supergsd/issues');
  assert.deepEqual(packageJson.pi?.extensions, ['./index.ts']);
  assert.equal(packageJson.peerDependencies?.['@earendil-works/pi-coding-agent'], '*');
  assert.equal(
    packageJson.scripts?.verify,
    'npm test && npm run updater && git diff --exit-code -- skills && npm pack --dry-run',
  );
});

test('README and LICENSE exist', () => {
  assert.equal(existsSync(join(rootDir, 'README.md')), true);
  assert.equal(existsSync(join(rootDir, 'LICENSE')), true);
});

test('README documents install, provenance, and non-affiliation', () => {
  const readme = readFileSync(join(rootDir, 'README.md'), 'utf8');
  for (const snippet of [
    '# pi-supergsd',
    'pi install npm:pi-supergsd',
    'obra/superpowers',
    'gsd-build/gsd-2',
    'not affiliated with, endorsed by, or part of the GSD project',
  ]) {
    assert.equal(readme.includes(snippet), true, `Missing README snippet: ${snippet}`);
  }
});

test('LICENSE is MIT', () => {
  const license = readFileSync(join(rootDir, 'LICENSE'), 'utf8');
  assert.equal(license.includes('MIT License'), true);
});
