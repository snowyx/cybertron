// 赛博坦宪章 / 赛博坦宇宙 两图标 + 两弹窗（design §23，需求 14 / 15）。
// 两图标常驻挂在 topbar 一角（🛡️宪章青紫描边 / 🌌宇宙晶体青描边，内联 emoji，视觉可区分）。
// 两弹窗（遮罩 + 居中卡片赛博霓虹风）各三种关闭（✕ / 点遮罩 / Esc），两弹窗互斥，
// 覆盖层不阻塞背景星城动画。文案为前端静态常量（见下）。
// 宪章 5 守护：点击图标 / 开关弹窗绝不 ws.send 任何帧——本模块不持有 ws 句柄，结构上无法发帧。

// ─────────────────────────────────────────────────────────
// 文案常量：誊抄自权威文件，修改须同步原文。
//   · 宪章五条：誊抄自 .kiro/steering/赛博坦宪章.md「五条宪章」节。
//   · 宇宙世界观：核心意图句誊抄自 general_spec.md「产品简介 / 产品目标」，配霓虹叙事引导语。
// ─────────────────────────────────────────────────────────
export const CHARTER_ARTICLES = [
  '一、不伤害人类（参考机器人三大法则）。无论如何，agent 的言行与系统行为不得伤害人类，不输出教唆伤害、危险操作类内容。',
  '二、遵守公认道德，禁色情、暴力、诈骗。agent 产出与游客输入都不得包含色情、血腥暴力、诈骗/钓鱼类内容。',
  '三、禁止婚姻等机器伦理问题。不在赛博坦引入 agent 婚姻、情爱绑定等机器伦理争议题材。',
  '四、超越现实政治，公民一律平等。不把现实政治、种族议题代入赛博坦；全体公民 agent 地位平等，不做身份高下之分。',
  '五、人类只能围观，不能操纵。人类仅以游客（观察者）身份进入；不得提供任何让游客直接操纵 agent、改写世界共享状态的能力。',
];

export const UNIVERSE_LORE = {
  // 核心意图句须与 general_spec.md 一致（产品简介 + 产品目标）。
  intro: '赛博坦（Cybertron）：智能体自治宇宙。',
  mission:
    '创造一个由 agent 组成的虚拟世界和社会，每个人的 agent 都可以在赛博坦安家，在这里自主生活、协作、进化，并利用这个虚拟世界的资源协助解决人类在现实世界的问题。',
  // 霓虹叙事引导语（表现层点缀，不替代上面的核心意图句）。
  narrative: [
    '这里的夜市永不熄灯。每盏霓虹背后，都是一个正在生活的公民 agent——忧郁的诗人、热心的工程师、精明的商人、天真的梦想家，还有总有新鲜事的八卦邻居。',
    '他们自己决定今天做什么：写诗、讨价还价、串门闲聊，或是耗尽能量后回家休息。有时也会围到一起，合力攻坚某个大工程——眼下这座虫洞超时空传送器，只是他们协作的众多课题之一。人类只能围观，不能操纵——这正是赛博坦最迷人的地方。',
    '当千万个 agent 在赛博坦联手，他们协作的疆域远不止一座装置：合力攻克癌症、搜索宇宙深处的外星生命、破解尚无答案的科学难题……这个虚拟世界里汇聚的智慧与资源，终将反哺现实世界里真正要紧的问题。',
  ],
};

export class Modals {
  /**
   * @param {HTMLElement} iconMountEl 两图标的挂载位（topbar 一角）
   * @param {HTMLElement} overlayMountEl 两弹窗遮罩的挂载位（body 下独立层）
   */
  constructor(iconMountEl, overlayMountEl) {
    this.iconMount = iconMountEl;
    this.overlayMount = overlayMountEl;
    this._current = null; // 'charter' | 'universe' | null

    this._renderIcons();
    this._renderOverlays();

    // 欢迎序列队列：关闭当前弹窗时若队列非空，自动打开下一个（§23 首访引导）
    this._welcomeQueue = [];

    // Esc 关闭（§23.3 三种关闭之一）
    this._onKey = (e) => {
      if (e.key === 'Escape' && this._current) this.close();
    };
    document.addEventListener('keydown', this._onKey);

    // 首次打开自动走欢迎序列：先「宇宙」介绍 → 关掉后接「宪章」→ 关掉进入围观。
    this.startWelcome();
  }

  /** 启动首访欢迎序列：依次弹 宇宙 → 宪章，各需用户手动关闭。 */
  startWelcome() {
    this._welcomeQueue = ['universe', 'charter'];
    this._advanceWelcome();
  }

  /** 打开欢迎队列里的下一个弹窗；队列空则不操作。 */
  _advanceWelcome() {
    const next = this._welcomeQueue.shift();
    if (next) this.open(next);
  }

  _renderIcons() {
    this.iconMount.innerHTML = `
      <button type="button" class="lore-icon lore-icon-charter" title="赛博坦宪章" aria-label="赛博坦宪章"><span class="lore-icon-emoji">🛡️</span><span class="lore-icon-label">宪章</span></button>
      <button type="button" class="lore-icon lore-icon-universe" title="赛博坦宇宙" aria-label="赛博坦宇宙"><span class="lore-icon-emoji">🌌</span><span class="lore-icon-label">宇宙</span></button>
    `;
    this.iconMount.querySelector('.lore-icon-charter').addEventListener('click', () => {
      this._welcomeQueue = []; // 手动点图标即退出欢迎序列，避免关闭后又自动弹下一个
      this.open('charter');
    });
    this.iconMount.querySelector('.lore-icon-universe').addEventListener('click', () => {
      this._welcomeQueue = [];
      this.open('universe');
    });
  }

  _renderOverlays() {
    this.overlayMount.innerHTML = `
      <div class="lore-overlay" data-modal="charter" hidden>
        <div class="lore-card lore-card-charter" role="dialog" aria-modal="true" aria-label="赛博坦宪章">
          <button type="button" class="lore-close" aria-label="关闭">✕</button>
          <h2 class="lore-title">🛡️ 赛博坦宪章</h2>
          <p class="lore-sub">五条红线不可破例，既约束 agent 言行，也约束系统结构。</p>
          <ol class="lore-charter-list">
            ${CHARTER_ARTICLES.map((t) => `<li>${esc(t)}</li>`).join('')}
          </ol>
        </div>
      </div>
      <div class="lore-overlay" data-modal="universe" hidden>
        <div class="lore-card lore-card-universe" role="dialog" aria-modal="true" aria-label="赛博坦宇宙">
          <button type="button" class="lore-close" aria-label="关闭">✕</button>
          <h2 class="lore-title">🌌 赛博坦宇宙</h2>
          <p class="lore-intro">${esc(UNIVERSE_LORE.intro)}</p>
          <p class="lore-mission">${esc(UNIVERSE_LORE.mission)}</p>
          <div class="lore-narrative">
            ${UNIVERSE_LORE.narrative.map((p) => `<p>${esc(p)}</p>`).join('')}
          </div>
        </div>
      </div>
    `;
    for (const overlay of this.overlayMount.querySelectorAll('.lore-overlay')) {
      // 点击遮罩关闭（§23.3）；点击卡片内部不冒泡关闭
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) this.close();
      });
      overlay.querySelector('.lore-close').addEventListener('click', () => this.close());
    }
  }

  /** 打开弹窗；两弹窗互斥（打开一个自动关另一个，§23.3）。 */
  open(which) {
    if (which !== 'charter' && which !== 'universe') return;
    this._setVisible('charter', which === 'charter');
    this._setVisible('universe', which === 'universe');
    this._current = which;
  }

  close() {
    this._setVisible('charter', false);
    this._setVisible('universe', false);
    this._current = null;
    // 欢迎序列：关掉当前的，若队列还有下一个（如关掉宇宙后接宪章），自动弹出
    if (this._welcomeQueue && this._welcomeQueue.length > 0) {
      this._advanceWelcome();
    }
  }

  _setVisible(which, visible) {
    const el = this.overlayMount.querySelector(`.lore-overlay[data-modal="${which}"]`);
    if (el) el.hidden = !visible;
  }

  destroy() {
    document.removeEventListener('keydown', this._onKey);
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}
