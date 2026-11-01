import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

// Prepare files only. Never changes a working tree, branch, device or storage.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const index=process.argv.indexOf('--out');
if(index<0||!process.argv[index+1])throw Error('Usage: node scripts/prepare-rollback.mjs --out /absolute/new-directory');
const out=path.resolve(process.argv[index+1]);
if(out===root||out.startsWith(root+path.sep)||fs.existsSync(out))throw Error('Choose a new directory outside this repository; existing paths are never overwritten.');
const baseline='ab19095da06e282a047b8c8aeb3832bc158e73a8';
const git=args=>execFileSync('git',args,{cwd:root});
if(git(['rev-parse','v1.7.0^{commit}']).toString().trim()!==baseline)throw Error('v1.7.0 does not match the verified baseline.');
const files=git(['ls-tree','-r','--name-only',baseline,'dist/']).toString().trim().split('\n').filter(Boolean);
// Read and validate everything before creating the destination.
const pending=files.map(file=>[file,git(['show',baseline+':'+file])]);
const cache='rainlift-shell-v1.7.0-rollback-'+randomUUID();
const worker=pending.find(([file])=>file==='dist/sw.js');
worker[1]=Buffer.from(worker[1].toString().replace(/const CACHE='[^']+';/,`const CACHE='${cache}';`));
if(!worker[1].toString().includes(cache))throw Error('Could not assign a fresh rollback cache.');
const pkg=git(['show',baseline+':package.json']);
fs.mkdirSync(out,{recursive:true});
for(const [file,bytes] of pending)for(const target of [file,file.replace(/^dist\//,'docs/')]){
 const dest=path.join(out,target);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);
}
fs.writeFileSync(path.join(out,'package.json'),pkg);
fs.writeFileSync(path.join(out,'rollback-manifest.json'),JSON.stringify({baseline,cache,preparedOnly:true,trainingStorage:'rainlift.web.v1',healthStorage:'rainlift.health.v1',metadataPreserved:'rainlift.exercise-meta.v1',files},null,2));
console.log(JSON.stringify({directory:out,baseline,cache,preparedOnly:true}));
