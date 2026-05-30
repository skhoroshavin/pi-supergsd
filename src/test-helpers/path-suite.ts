import { it } from 'node:test';

import { makeHarness, type Harness } from './make-harness.js';

export function pathSuite(...roots: PathNode[]): void {

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

export const path: PathFn = (name, fn, ...children) => ({ name, fn, children });

export type PathFn = (
  name: string,
  fn?: (h: Harness) => Promise<void> | void,
  ...children: PathNode[]
) => PathNode;

export interface PathNode {
  name: string;
  fn?: (h: Harness) => Promise<void> | void;
  children: PathNode[];
}
