export interface PatchResult {
  result: string;
  unmatched: Patch[];
}

export interface SkillDefinition {
  name: string;
  files?: SkillFile[];
  exclude?: string[];
}

export interface SkillFile {
  path: string;
  patches: Patch[];
}

export type Patch = PatchOp;

export type PatchOp =
  | { op: "replace"; find: string; replace: string }
  | { op: "regex-replace"; find: string; replace: string }
  | { op: "delete-line"; find: string }
  | { op: "delete-block"; findStart: string; findEnd: string }
  | { op: "prepend"; text: string }
  | { op: "append"; text: string };
