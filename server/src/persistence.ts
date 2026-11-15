import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { SnapshotSchema, type Snapshot } from '../../shared/protocol.js';

export class WorldRepository {
  constructor(readonly path: string | null) {}
  async load(): Promise<Snapshot | null> {
    if (!this.path) return null;
    try {
      return SnapshotSchema.parse(JSON.parse(await readFile(this.path, 'utf8')));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new Error('世界存档损坏，已停止启动以保护原存档', { cause: e });
    }
  }
  async save(snapshot: Snapshot) {
    if (!this.path) return;
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path + '.tmp', JSON.stringify(SnapshotSchema.parse(snapshot)), {
      mode: 0o600,
    });
    await rename(this.path + '.tmp', this.path);
  }
}
