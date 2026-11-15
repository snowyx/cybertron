// 顶部 HUD（产品级星城状态条）。
// 数据只读 store 快照：星城日进度环 / 醒着公民 / 晶体总量 / 言行轨道。
// 纯表现层：不推进任何共享状态，不自算 token 经济。

const TICKS_PER_DAY = 24; // 与 server/world.js TICKS_PER_DAY 保持同步
const RING_CIRCUMFERENCE = 2 * Math.PI * 16; // r=16

export class Hud {
  /**
   * @param {{ringFill:HTMLElement,dayValue:HTMLElement,dayLabel:HTMLElement,activeValue:HTMLElement,crystalValue:HTMLElement,modeBadge:HTMLElement}} els
   * @param {object} store 只读快照镜像
   */
  constructor(els, store) {
    this.els = els;
    this.store = store;
  }

  /** world_state / agent_update 后统一刷新。 */
  render() {
    const s = this.store.snapshot;
    if (!s) return;

    // 星城日进度环
    const progress = Math.max(0, Math.min(1, Number(s.dayProgress) || 0));
    const day = Math.floor(Number(s.tick) || 0) / TICKS_PER_DAY + 1;
    this.els.ringFill.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - progress));
    this.els.dayValue.textContent = `第 ${Math.floor(day)} 天`;
    this.els.dayLabel.textContent =
      s.phase === 'discussing' ? '圆桌讨论' : `日进度 ${Math.round(progress * 100)}%`;

    // 醒着公民（active + isolated 都算醒着，只是隔离中无法产出）
    const agents = s.agents || [];
    const awake = agents.filter((a) => a.status !== 'asleep').length;
    this.els.activeValue.textContent = `${awake}/${agents.length}`;

    // 晶体总量
    const crystals = agents.reduce((sum, a) => sum + (Number(a.crystals) || 0), 0);
    this.els.crystalValue.textContent = String(crystals);

    // 言行轨道角标
    this.els.modeBadge.textContent = `轨道：${s.mode === 'llm' ? '真实模型' : '剧本'}`;
  }
}
