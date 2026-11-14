// Publishes the site to the 'deploy' branch, which is what Cloudflare serves (Nov 1).
// main holds only the source and data; the built pages, page copies and generated share images live only on 'deploy',
// as ONE commit that is replaced every time, so old builds never pile up in the repo's history.
//
//   node scripts/publish-deploy.mjs                 latest main + the built files already on 'deploy' (data-only updates)
//   node scripts/publish-deploy.mjs --from-worktree latest main + the built files in this folder (after a page build)
//   node scripts/publish-deploy.mjs --restore       copy the built files from 'deploy' into this folder (before a build)
//
// Each publish re-reads main and 'deploy' and only replaces 'deploy' if nobody else changed it in the meantime
// (force-with-lease), retrying a few times, so two jobs publishing at once can't undo each other.
import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';

// Keep in step with .gitignore: everything a build writes.
export const BUILT = [
  /^(?!index\.html$|live\.src\.html$|404\.html$)[^/]+\.html$/,
  /^(a|embed|games|players|history|media)\//,
  /^og\/(g|h|p|gp|gl)\//,
  /^og\/(live\.json|cap\.jpg|schedule\.jpg|assets\.jpg|moves\.jpg|history\.jpg)$/,
  /^sitemap\.xml$/,
  /^data\/prerender-hash\.txt$/,
];
const isBuilt = p => BUILT.some(r => r.test(p));
const sh = (c, env) => execSync(c, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, env: env ? { ...process.env, ...env } : process.env, stdio: ['pipe', 'pipe', 'inherit'] });
const tryRev = r => { try { return sh(`git rev-parse -q --verify ${r}`).trim(); } catch { return ''; } };
const fetchBoth = () => { try { sh('git fetch -q --no-tags origin +refs/heads/main:refs/remotes/origin/main +refs/heads/deploy:refs/remotes/origin/deploy'); } catch { sh('git fetch -q --no-tags origin +refs/heads/main:refs/remotes/origin/main'); } };
const builtIn = rev => sh(`git ls-tree -r --full-tree ${rev}`).split('\n').filter(Boolean).filter(l => isBuilt(l.split('\t')[1]));

const mode = process.argv.includes('--restore') ? 'restore' : process.argv.includes('--from-worktree') ? 'worktree' : 'deploy';

if (mode === 'restore') {
  fetchBoth();
  const base = tryRev('refs/remotes/origin/deploy');
  if (!base) { console.log('no deploy branch yet; nothing to restore'); process.exit(0); }
  const paths = builtIn(base).map(l => l.split('\t')[1]);
  if (!paths.length) { console.log('deploy branch has no built files'); process.exit(0); }
  // in batches, so the command line never gets too long
  for (let i = 0; i < paths.length; i += 300) sh(`git archive ${base} -- ${paths.slice(i, i + 300).map(p => `'${p.replace(/'/g, `'\\''`)}'`).join(' ')} | tar -x`);
  console.log(`restored ${paths.length} built files from deploy ${base.slice(0, 9)}`);
  process.exit(0);
}

const IDX = `/tmp/deploy-index-${process.pid}`;
for (let i = 1; i <= 6; i++) {
  fetchBoth();
  const main = tryRev('refs/remotes/origin/main'), base = tryRev('refs/remotes/origin/deploy');
  const env = { GIT_INDEX_FILE: IDX };
  rmSync(IDX, { force: true });
  sh(`git read-tree ${main}`, env);                                   // main's source and data, as of right now
  sh('git rm -r -q --cached --ignore-unmatch .github', env);           // the site never needs the workflow files
  if (mode === 'worktree') {
    const have = ['a', 'embed', 'games', 'players', 'history', 'media', 'og', 'sitemap.xml', 'data/prerender-hash.txt'].filter(p => existsSync(p));
    sh(`git add -f -- ${have.join(' ')} $(ls *.html | grep -v -x -e index.html -e live.src.html -e 404.html)`, env);
  } else {
    if (!base) { console.log('no deploy branch to take the built pages from; skipping'); process.exit(0); }
    execSync('git update-index --index-info', { input: builtIn(base).join('\n') + '\n', env: { ...process.env, ...env } });
  }
  if (!sh('git ls-files', env).split('\n').includes('home.html')) { console.log('::warning::no built pages to publish (home.html missing); leaving deploy as it is'); process.exit(0); }
  const tree = sh('git write-tree', env).trim();
  if (base && tree === sh(`git rev-parse ${base}^{tree}`).trim()) { console.log('deploy already matches; nothing to publish'); process.exit(0); }
  if (process.argv.includes('--dry')) { const n = sh('git ls-files', env).split('\n').filter(Boolean); console.log(`dry run: would publish ${n.length} files (${n.filter(isBuilt).length} built) from main ${main.slice(0, 9)}`); rmSync(IDX, { force: true }); process.exit(0); }
  const c = sh(`git commit-tree ${tree} -m "Site build ${new Date().toISOString().slice(0, 16)}Z from main ${main.slice(0, 9)}"`).trim();
  try {
    sh(`git push -q --force-with-lease=refs/heads/deploy:${base} origin ${c}:refs/heads/deploy`);
    console.log(`published ${c.slice(0, 9)} (main ${main.slice(0, 9)}) to deploy`);
    rmSync(IDX, { force: true });
    process.exit(0);
  } catch { console.log(`deploy moved while publishing; retrying (${i})`); }
  execSync(`sleep ${Math.floor(Math.random() * 10) + i * 5}`);
}
console.log('::warning::could not publish the deploy branch');
process.exit(0);
