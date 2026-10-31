import { execSync } from 'node:child_process';import fs from 'node:fs';
console.log(execSync('node scripts/sos.mjs',{encoding:'utf8'}));
fs.mkdirSync('scratch-out',{recursive:true});fs.copyFileSync('pdata/sos.json','scratch-out/sos.json');fs.copyFileSync('data/league-schedule.json','scratch-out/league-schedule.json');
