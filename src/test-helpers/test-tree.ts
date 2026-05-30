import { it } from 'node:test';

import { TestHarness } from './test-harness.js';

export function node(name: string, fn: NodeFn) {
  return new TestNode(name, fn);
}

export type NodeFn = (h: TestHarness) => Promise<void> | void;

export class TestNode {
  constructor(
    private readonly name: string,
    private readonly fn?: NodeFn,
  ) {}

  private readonly childPaths: TestNode[] = [];
  private registered = false;

  children(...children: TestNode[]): TestNode {
    this.childPaths.push(...children);
    return this;
  }

  run(): void {
    this.register([]);
  }

  private register(ancestors: TestNode[]): void {
    if (this.registered) {
      throw new Error(`Path "${this.name}" has already been registered`);
    }

    this.registered = true;

    const chain = [...ancestors, this];
    const name = chain.map(node => node.name).join(' → ');

    it(name, async () => {
      const h = new TestHarness();

      for (const node of chain) {
        await node.fn?.(h);
      }
    });

    for (const child of this.childPaths) {
      child.register(chain);
    }
  }
}
