import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
for (const name of ['city', 'citizen', 'engineer']) {
  const path = `web/public/assets/polyfork/${name}.glb`;
  const before = (await readFile(path)).byteLength;
  const doc = await io.read(path);
  await doc.transform(
    dedup(),
    prune(),
    weld(),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  await io.write(path, doc);
  const bytes = await readFile(path);
  console.log(`${name}: ${before} -> ${bytes.byteLength} bytes`);
  if (name === 'city') {
    const manifestPath = 'web/public/assets/polyfork/manifest.json';
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.bytes = bytes.byteLength;
    manifest.sha256 = createHash('sha256').update(bytes).digest('hex');
    manifest.compression = 'EXT_meshopt_compression';
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  }
}
