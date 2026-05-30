import { it } from 'node:test';

import { makeHarness, type Harness } from './make-harness.js';

export { pathSuite, path };
export type { PathNode, PathFn };

function pathSuite(...roots: PathNode[]): void {

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

  for (const root of roots) {
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
