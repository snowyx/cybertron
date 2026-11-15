// Build Polyfork's authored placement layout offline, keeping runtime independent of its CDN.
// Input: licensed kit zip extracted to .cache/polyfork. Output: merged GLB + credits.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { createCanvas } from '@napi-rs/canvas';

const folder = pathToFileURL(resolve('.cache/polyfork') + '/').href;
globalThis.document = { baseURI: folder, createElement: () => createCanvas(128, 128) };
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith('file://'))
    return new Response(await readFile(fileURLToPath(url)), { status: 200 });
  return nativeFetch(input, init);
};
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = 'data:' + blob.type + ';base64,' + Buffer.from(result).toString('base64');
      this.onloadend?.();
    });
  }
};
const { buildKit } = await import(folder + 'kit.mjs');
const keys = [
  'civic-dome-pavilion',
  'vehicle-depot-hangar',
  'transit-station-module',
  'retail-podium-arcade',
  'vertical-farm-tower',
];
const place = await buildKit({
  folder,
  people: 'none',
  keep: keys,
  night: true,
  params: { shell: '#8eaaad' },
});
place.night(0.65);
// Runtime draws its own light pools. Avoid serializing CanvasTexture implementation details.
const lightPools = place.group.getObjectByName('lamp-pools');
if (lightPools) lightPools.removeFromParent();
// Ambient transit and pedestrians from the authored scene aren't autonomous citizens.
place.group.name = 'CYBERTRON_ARCOLOGY';
const output = resolve('web/public/assets/polyfork');
await mkdir(output, { recursive: true });
const buffer = await new GLTFExporter().parseAsync(place.group, {
  binary: true,
  onlyVisible: true,
});
await writeFile(output + '/city.glb', Buffer.from(buffer));
await copyFile('.cache/polyfork/city-commuter.glb', output + '/citizen.glb');
await copyFile('.cache/polyfork/maintenance-technician.glb', output + '/engineer.glb');
await copyFile('.cache/polyfork/LICENSE.txt', output + '/LICENSE.txt');
await copyFile('.cache/polyfork/CREDITS.txt', output + '/CREDITS.txt');
const manifest = {
  kit: 'chrome-arcology-transit-kit-87a0e1',
  source: 'https://polyfork.dev/kit/chrome-arcology-transit-kit-87a0e1',
  license: 'Polyfork project license; mesh files also CC BY 4.0',
  modified:
    'Offline merge of authored layout, shell tint, night materials, remove ambient people; original proportions retained',
  sha256: createHash('sha256').update(Buffer.from(buffer)).digest('hex'),
  bytes: buffer.byteLength,
  bounds: { min: place.bounds.min.toArray(), max: place.bounds.max.toArray() },
  landmarks: Object.fromEntries(keys.map((k) => [k, place.where(k).map((v) => v.toArray())])),
};
await writeFile(output + '/manifest.json', JSON.stringify(manifest, null, 2));
console.log(
  JSON.stringify(
    { bytes: buffer.byteLength, bounds: manifest.bounds, landmarks: manifest.landmarks },
    null,
    2,
  ),
);
