import { it } from "node:test";

import { ReactionEngine } from "./reaction-engine.js";
import { TestHarness } from "./harness.js";

export function node(name: string, fn: NodeFn) {
  return new TestNode(name, fn);
}

type NodeFn = (h: TestHarness) => Promise<void> | void;

class TestNode {
  constructor(
    private readonly name: string,
    private readonly fn?: NodeFn,
  ) {}

  private readonly childNodes: TestNode[] = [];
  private registered = false;

  children(...children: TestNode[]): TestNode {
    this.childNodes.push(...children);
    return this;
  }

  run(): void {
    this.register([]);
  }

  private register(ancestors: TestNode[]): void {
    if (this.registered) {
      throw new Error(`Node "${this.name}" has already been registered`);
    }

    this.registered = true;

    const chain = [...ancestors, this];
    const name = chain.map((node) => node.name).join(" → ");

    it(name, async () => {
      const h = await TestHarness.create(new ReactionEngine());
      try {
        for (const node of chain) {
          await node.fn?.(h);
        }
      } finally {
        h.dispose();
      }
    });

    for (const child of this.childNodes) {
      child.register(chain);
    }
  }
}
