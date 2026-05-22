import type { Patch, PatchResult } from './types.js';

export function applyPatches(content: string, patches: Patch[]): PatchResult {
  const unmatched: Patch[] = [];
  let result = content;

  for (const patch of patches) {
    if (patch.op === 'replace') {
      if (!result.includes(patch.find)) {
        unmatched.push(patch);
      } else {
        result = result.split(patch.find).join(patch.replace);
      }
    } else if (patch.op === 'regex-replace') {
      const regex = new RegExp(patch.find, 'g');
      const after = result.replace(regex, patch.replace);
      if (after === result) {
        unmatched.push(patch);
      } else {
        result = after;
      }
    } else if (patch.op === 'delete-line') {
      const lines = result.split('\n');
      const filtered = lines.filter((line) => !line.includes(patch.find));
      if (filtered.length === lines.length) {
        unmatched.push(patch);
      } else {
        result = filtered.join('\n');
      }
    } else if (patch.op === 'delete-block') {
      const lines = result.split('\n');
      const startIdx = lines.findIndex((line) => line.includes(patch.findStart));
      const endIdx = lines.findIndex((line) => line.includes(patch.findEnd));
      if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
        unmatched.push(patch);
      } else {
        lines.splice(startIdx, endIdx - startIdx + 1);
        result = lines.join('\n');
      }
    } else if (patch.op === 'prepend' || patch.op === 'append') {
      result = patch.op === 'prepend' ? patch.text + result : result + patch.text;
    } else {
      throw new Error(`Invalid patch operation: ${JSON.stringify(patch)}`);
    }
  }

  return { result, unmatched };
}
