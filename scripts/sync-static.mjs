import {readdir,copyFile} from 'node:fs/promises';
for(const name of await readdir(new URL('../docs/',import.meta.url)))if(/\.(js|html|css|png|webmanifest)$/.test(name))await copyFile(new URL('../docs/'+name,import.meta.url),new URL('../dist/'+name,import.meta.url));
