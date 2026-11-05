import {execFileSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const BASELINE = '00afdb4188f8c2e716e0465ee3e1bd975adb3415';

export function unpackBaseline(target) {
  const git = (...args) => execFileSync('git', args, {cwd: ROOT});
  if (git('rev-parse', 'v1.8.4^{commit}').toString().trim() !== BASELINE) {
    throw Error('The local v1.8.4 tag does not match the audited SHA.');
  }
  mkdirSync(target, {recursive:true});
  execFileSync('tar', ['-xf', '-', '-C', target], {input:git('archive', BASELINE, 'dist', 'package.json')});
}
