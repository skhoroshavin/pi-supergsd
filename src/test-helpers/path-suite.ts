import { it } from 'node:test';

import { makeHarness, type Harness } from './make-harness.js';

export { pathSuite };
export type { PathNode, PathFn };

function pathSuite(
  fn: (path: PathFn) => PathNode | PathNode[],
): void {
  const roots = fn(path);
  const rootsArray = Array.isArray(roots) ? roots : [roots];

  function registerTests(node: PathNode, ancestors: PathNode[]): void {
    const chain = [...ancestors, node];
    const name = chain.map(n => n.name).join(' → ');

    it(name, async () => {
      const h = makeHarness();
      for (const ancestor of chain) {
        if (ancestor.fn) {
          await ancestor.fn(h);
        }
      }
    });

    for (const child of node.children) {
      registerTests(child, chain);
    }
  }

  for (const root of rootsArray) {
    registerTests(root, []);
  }
}

const path: PathFn = (name, fn, ...children) => ({ name, fn, children });

type PathFn = (
  name: string,
  fn?: (h: Harness) => Promise<void> | void,
  ...children: PathNode[]
) => PathNode;

interface PathNode {
  name: string;
  fn?: (h: Harness) => Promise<void> | void;
  children: PathNode[];
}
