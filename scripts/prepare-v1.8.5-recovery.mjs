import {execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {existsSync, mkdirSync, realpathSync, writeFileSync} from 'node:fs';
import {basename, dirname, isAbsolute, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Package the verified v1.8.4 behavior for isolated recovery testing.
const root = fileURLToPath(new URL('../', import.meta.url));
const baseline = '00afdb4188f8c2e716e0465ee3e1bd975adb3415';
const args = process.argv.slice(2);
const outputArg = args[1];
const buildID = args[3] ?? randomUUID();
if (args[0] !== '--out' || !outputArg || !isAbsolute(outputArg)
    || ![2,4].includes(args.length) || (args.length === 4 && args[2] !== '--build-id')
    || !/^[a-z0-9-]{1,60}$/.test(buildID)) {
  throw Error('Usage: node scripts/prepare-v1.8.5-recovery.mjs --out /absolute/new-directory [--build-id id]');
}
const dest = resolve(realpathSync(dirname(resolve(outputArg))), basename(resolve(outputArg)));
const withinRepo = relative(realpathSync(root), dest);
if (!withinRepo.startsWith('../') || existsSync(dest)) throw Error('Choose a new directory outside the checkout.');

const git = (...params) => execFileSync('git', params, {cwd:root});
if (git('rev-parse', 'v1.8.4^{commit}').toString().trim() !== baseline) throw Error('v1.8.4 does not match the verified baseline.');
const version = '1.8.4-recovery.r' + buildID;
const cache = 'rainlift-shell-v' + version;
const files = git('ls-tree', '-r', '--name-only', baseline, 'dist/').toString().trim().split('\n');
const build = new Map();
for (const path of files) {
  let bytes = git('show', baseline + ':' + path);
  if (/\.(js|html|css)$/.test(path)) {
    let content = bytes.toString().replaceAll('?v=1.8.4', '?v=' + version);
    if (path === 'dist/sw.js') content = content.replace('rainlift-shell-v1.8.4', cache);
    if (path === 'dist/app.js') content = content
      .replace(/<p>当前版本：1\.8\.2[^<]*<\/p><details>.*?<\/details>/, '<p>当前版本：' + version + '</p>')
      .replace('Rain Lift · 网页版 1.8.4', 'Rain Lift · 网页版 ' + version);
    bytes = Buffer.from(content);
  }
  build.set(path, bytes);
  build.set(path.replace(/^dist\//, 'docs/'), bytes);
}
if (!build.get('dist/sw.js')?.toString().includes(cache)
    || !build.get('dist/app.js')?.toString().includes('当前版本：' + version)) throw Error('Recovery version metadata could not be updated.');

const pkg = JSON.parse(git('show', baseline + ':package.json'));
build.set('package.json', Buffer.from(JSON.stringify({...pkg,version},null,2) + '\n'));
const sha256 = Object.fromEntries([...build].map(([file, bytes]) => [file,createHash('sha256').update(bytes).digest('hex')]));
const manifest = {baseline,buildID,version,cache,preparedOnly:true,trainingFormats:[1,2],fullBackupFormat:1,sha256};
mkdirSync(dest);
for (const [file,bytes] of build) {
  const target = resolve(dest,file);
  mkdirSync(dirname(target),{recursive:true});
  writeFileSync(target,bytes,{flag:'wx'});
}
writeFileSync(resolve(dest,'rollback-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({directory:dest,baseline,version,cache,files:build.size,preparedOnly:true},null,2));
