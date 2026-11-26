// Synthetic bounded cases. Separate processes keep peak RSS observations independent.
import { spawnSync } from 'node:child_process';
import { parseGpx } from '../apps/api/src/gpx-parser.ts';
import { gpx, point } from '../apps/api/src/gpx-fixtures.ts';

const scenario = process.argv[2];
if (!scenario) {
  for (const name of ['points', 'elements', 'depth-rejected']) {
    const run = spawnSync(process.execPath, ['--experimental-strip-types', '--expose-gc', import.meta.filename, name], { stdio: 'inherit' });
    if (run.error) throw run.error;
    if (run.status !== 0) process.exit(run.status ?? 1);
  }
} else {
  const content = scenario === 'points' ? gpx(point().repeat(100_000))
    : scenario === 'elements' ? gpx().replace('<trk>', `<metadata>${'<x/>'.repeat(499_994)}</metadata><trk>`)
    : gpx().replace('<trk>', `<metadata>${'<x>'.repeat(63)}${'</x>'.repeat(63)}</metadata><trk>`);
  global.gc();
  const before = process.memoryUsage();
  const started = performance.now();
  let outcome;
  try {
    const result = parseGpx(content);
    outcome = `${result.segments.reduce((sum, s) => sum + s.samples.length, 0)} samples`;
  } catch (error) {
    if (scenario !== 'depth-rejected' || error.code !== 'RESOURCE_LIMIT') throw error;
    outcome = error.code;
  }
  const elapsed = performance.now() - started;
  const after = process.memoryUsage();
  console.log(JSON.stringify({ scenario, bytes: Buffer.byteLength(content), outcome,
    elapsedMs: Math.round(elapsed), peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
    heapGrowthMiB: Math.round((after.heapUsed - before.heapUsed) / 1024 / 1024) }));
}
