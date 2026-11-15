import { createWorld, TICKS_PER_DAY, SLEEP_TICKS, ISOLATION_TICKS } from '../world.js';
import { tick, makeSnapshot, handleVisitorAsk, frame } from '../engine.js';
import { resolveMode, generateEvent, generateSpeech, summarizeResolution } from '../behavior.js';
import { SnapshotSchema, type Snapshot, type Envelope } from '../../shared/protocol.js';
import { WorldRepository } from './persistence.js';

export class WorldRuntime {
  readonly world = createWorld();
  readonly listeners = new Set<(frame: Envelope) => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private steps = new Set<ReturnType<typeof setTimeout>>();
  private stopped = false;
  private tickQueued = false;
  private readonly deps;
  constructor(
    readonly repository: WorldRepository,
    readonly interval = 3000,
    readonly discussionInterval = 1500,
  ) {
    const { mode, llm } = resolveMode(process.env);
    this.world.mode = mode;
    this.world.llm = llm;
    // Scripted disciplinary incidents belong to the archived demonstration only.
    Object.assign(this.world, { _isolationDemoTick: 0 });
    this.deps = {
      mode,
      llm,
      generateEvent,
      generateSpeech,
      summarizeResolution,
      clients: new Set(),
      broadcast: (_clients: unknown, f: Envelope) => this.publish(f),
      scheduleStep: (fn: () => Promise<void>) => {
        if (this.stopped) return;
        const timer = setTimeout(() => {
          this.steps.delete(timer);
          void this.enqueue(fn).catch(() => {});
        }, this.discussionInterval);
        this.steps.add(timer);
      },
    };
  }
  snapshot(): Snapshot {
    const snapshot = makeSnapshot(this.world);
    return SnapshotSchema.parse({
      ...snapshot,
      discussion: this.world.discussion
        ? {
            id: (this.world.discussion as { id: string }).id,
            question: (this.world.discussion as { question: string }).question,
          }
        : null,
    });
  }
  publish(f: Envelope) {
    for (const listener of this.listeners) listener(f);
  }
  private enqueue<T>(fn: () => Promise<T> | T): Promise<T> {
    const result = this.queue.then(async () => {
      if (this.stopped) return undefined as T;
      const value = await fn();
      this.publish(frame('world_tick', { snapshot: this.snapshot() }));
      await this.repository.save(this.snapshot());
      return value;
    });
    this.queue = result.catch((error) => {
      console.error(
        '[world-runtime]',
        error instanceof Error ? error.message : 'World task failed',
      );
      this.publish(frame('service_error', { message: '世界状态保存或计算失败，请检查服务日志。' }));
    });
    return result;
  }
  async start() {
    const saved = await this.repository.load();
    if (saved) {
      this.world.tick = saved.tick;
      this.world.dayStartTick = saved.tick - Math.round(saved.dayProgress * TICKS_PER_DAY);
      this.world.project = saved.project;
      this.world.recentEvents = saved.recentEvents as never[];
      for (const a of saved.agents) {
        const current = this.world.agents.get(a.id);
        if (current) {
          Object.assign(current, a);
          current.wakeAtTick = a.status === 'asleep' ? saved.tick + SLEEP_TICKS : 0;
          current.isolatedUntilTick = a.status === 'isolated' ? saved.tick + ISOLATION_TICKS : 0;
        }
      }
      if (saved.phase === 'discussing')
        this.world.recentEvents.push({
          kind: 'system',
          text: '服务重启，上一场未完成的讨论已结束，请重新广播问题。',
          ts: Date.now(),
          agentId: null,
          name: '赛博坦',
        } as never);
    }
    this.timer = setInterval(() => {
      if (this.tickQueued || this.stopped) return;
      this.tickQueued = true;
      void this.enqueue(() => tick(this.world, this.deps))
        .catch(() => {})
        .finally(() => {
          this.tickQueued = false;
        });
    }, this.interval);
  }
  ask(question: string) {
    return this.enqueue(() => handleVisitorAsk(this.world, question, this.deps));
  }
  async stop() {
    clearInterval(this.timer);
    for (const t of this.steps) clearTimeout(t);
    this.steps.clear();
    // Let the in-flight action finish; scheduled callbacks see stopped after drain.
    await this.queue;
    this.stopped = true;
    for (const t of this.steps) clearTimeout(t);
    this.steps.clear();
    await this.repository.save(this.snapshot());
  }
}
