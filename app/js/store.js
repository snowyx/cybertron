// 后端快照的只读镜像（design §10 / NFR-3）。
// 前端从不自行推进 tick / 能量 / 状态——违反即破坏单一事实源。
// world_state 覆盖全量；agent_update 为「部分字段 patch」。

export class Store {
  constructor() {
    this.snapshot = {
      tick: 0,
      phase: 'idle',
      mode: 'script',
      agents: [],
      recentEvents: [],
      // 二期：虫洞工程只读快照（§20.6）。world_state 覆盖、project_update 增量。
      project: { progress: 0, round: 1, status: 'building' },
    };
    this._listeners = new Set();
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit(evt) {
    for (const fn of this._listeners) {
      try {
        fn(evt);
      } catch (e) {
        console.error(e);
      }
    }
  }

  /** world_state：全量覆盖。 */
  applyWorldState(data) {
    const snap = data && data.snapshot;
    if (!snap) return;
    this.snapshot = {
      tick: snap.tick ?? 0,
      phase: snap.phase ?? 'idle',
      mode: snap.mode ?? 'script',
      agents: Array.isArray(snap.agents) ? snap.agents.map((a) => ({ ...a })) : [],
      recentEvents: Array.isArray(snap.recentEvents) ? snap.recentEvents.slice() : [],
      project: this._readProject(snap.project),
    };
    this._emit({ kind: 'world_state' });
  }

  /** 防御式读取 project 快照；缺省/非法回退到安全默认。 */
  _readProject(p) {
    const prev = (this.snapshot && this.snapshot.project) || { progress: 0, round: 1, status: 'building' };
    if (!p || typeof p !== 'object') return { ...prev };
    const progress =
      typeof p.progress === 'number' ? Math.round(Math.max(0, Math.min(100, p.progress))) : prev.progress;
    const round = typeof p.round === 'number' && p.round >= 1 ? Math.round(p.round) : prev.round;
    const status = p.status === 'building' || p.status === 'completed' ? p.status : 'building';
    return { progress, round, status };
  }

  /**
   * project_update：覆盖 snapshot.project（§20.7 防御式校验）。
   * progress 必填 number 钳到 [0,100] 整数；round 必填 number≥1；status∈{building,completed}。
   * 非法字段保留旧值（progress 非 number 时忽略整帧的 progress，其余同理）。
   */
  applyProjectUpdate(data) {
    if (!data || typeof data !== 'object') return;
    const prev = this.snapshot.project || { progress: 0, round: 1, status: 'building' };
    const next = { ...prev };
    if (typeof data.progress === 'number' && Number.isFinite(data.progress)) {
      next.progress = Math.round(Math.max(0, Math.min(100, data.progress)));
    }
    if (typeof data.round === 'number' && Number.isFinite(data.round) && data.round >= 1) {
      next.round = Math.round(data.round);
    }
    if (data.status === 'building' || data.status === 'completed') {
      next.status = data.status;
    } else {
      next.status = 'building';
    }
    this.snapshot.project = next;
    this._emit({ kind: 'project_update' });
  }

  /**
   * agent_update：部分字段 patch。按 agentId 定位既有 agent，仅覆盖
   * status/energy/energyMax/crystals，保留 name/persona/home。未知 agentId 忽略不新建。
   */
  applyAgentUpdate(data) {
    if (!data || !data.agentId) return;
    const agent = this.snapshot.agents.find((a) => a.id === data.agentId);
    if (!agent) return; // 未知 agentId：忽略该帧
    if (typeof data.status === 'string') agent.status = data.status;
    if (typeof data.energy === 'number') agent.energy = data.energy;
    if (typeof data.energyMax === 'number') agent.energyMax = data.energyMax;
    if (typeof data.crystals === 'number') agent.crystals = data.crystals;
    this._emit({ kind: 'agent_update', agentId: data.agentId });
  }

  getAgents() {
    return this.snapshot.agents;
  }

  getAgent(id) {
    return this.snapshot.agents.find((a) => a.id === id) || null;
  }

  get mode() {
    return this.snapshot.mode;
  }
}
