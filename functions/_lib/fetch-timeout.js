// A hard application deadline, including response-body reads. Do not replay writes.
export async function withDeadline(task, milliseconds = 10000) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('upstream_timeout')); }, milliseconds);
  });
  try { return await Promise.race([task(controller.signal), timeout]); }
  finally { clearTimeout(timer); }
}
