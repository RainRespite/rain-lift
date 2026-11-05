import {execFileSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const BASELINE = '00afdb4188f8c2e716e0465ee3e1bd975adb3415';

const verified={'v1.8.4':BASELINE,'v1.8.5':'859da7955840c21528d572ab6d3d4fd9cb21ab0e'};
export function unpackBaseline(target,tag='v1.8.4') {
  if(!Object.hasOwn(verified,tag))throw Error('Unsupported compatibility baseline ' + tag);
  const baseline=verified[tag];
  const git = (...args) => execFileSync('git', args, {cwd: ROOT});
  if (git('rev-parse', tag + '^{commit}').toString().trim() !== baseline) {
    throw Error('The local ' + tag + ' tag does not match the audited SHA.');
  }
  mkdirSync(target, {recursive:true});
  execFileSync('tar', ['-xf', '-', '-C', target], {input:git('archive', baseline, 'dist', 'package.json')});
}
