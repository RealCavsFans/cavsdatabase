// Starts headless Chrome, retrying when it hangs on startup. GitHub's machines now and then fail to bring Chrome up
// (Playwright's "browserType.launch: Timeout" error), which used to fail the whole run. Each try waits up to 60 seconds,
// then the next one starts fresh; only three failed tries in a row count as a real failure.
export async function launch(pw, opts = {}, tries = 3) {
  for (let i = 1; ; i++) {
    try { return await pw.chromium.launch({ timeout: 60000, ...opts }); }
    catch (e) {
      if (i >= tries) throw e;
      console.log(`Chrome did not start (try ${i} of ${tries}): ${String(e.message).split('\n')[0]}; trying again`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}
