// 单个像素小人（design §19.2 / §19.3 / §30.1）。
// figureStyle(id)：从 agent.id 确定性派生异色异脸（PALETTE 5 色霓虹同系 + FACES 5 个内联字符），
// 同一 id 恒定、全景/内景/多游客一致。PALETTE/FACES 为内景专用（与 theme.css 五主色并存，
// §26 steering 登记的唯一散色例外）。PixelFigure：持 {id,name,color,face}，一个本地动作状态机
// （walk/type/water/drink/read/idle）+ 头顶名字标签 + 气泡渲染。纯表现层、零外部图片。

// 内景专用小人配色：皆为霓虹系，与 theme.css 五个锁定主题变量并存、不冲突（§19.2 / §26 登记）。
export const PALETTE = ['#A24BFF', '#38F2E6', '#FF8A3D', '#7CF25A', '#4BA8FF'];
// 内联字符作头像标识，零外部图片。
export const FACES = ['◕', '◉', '⊙', '◔', '✦'];

/** 简单稳定哈希：对同一字符串恒定返回同一非负整数。 */
export function hashId(id) {
  const s = String(id ?? '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 从 id 确定性派生 {color,face}，同一 id 恒定（§19.2）。 */
export function figureStyle(id) {
  const h = hashId(id);
  return {
    color: PALETTE[h % PALETTE.length],
    face: FACES[(h >> 3) % FACES.length],
  };
}

// 动作集枚举（与 home-interior.js INTERIOR_SCRIPT 的 actions.kind 对齐，§19.4）。
export const ACTIONS = ['walk', 'type', 'water', 'drink', 'read', 'idle'];

/**
 * 像素小人：纯表现层 DOM 元素（头顶名字 + 身体 + 气泡）。
 * 位置/动作/气泡由 home-interior.js 的 rAF 循环驱动；本类只负责「长什么样、当前动作怎么画」。
 */
export class PixelFigure {
  /**
   * @param {{id:string,name:string,status:string}} agent 后端快照里的只读事实
   */
  constructor(agent) {
    this.id = agent.id;
    this.name = agent.name;
    this.status = agent.status;
    const style = figureStyle(agent.id);
    this.color = style.color;
    this.face = style.face;

    // 本地表现层状态（home-interior 写入，纯前端自驱动）
    this.x = 0.5; // 房间内归一化坐标 [0,1]
    this.y = 0.7;
    this.action = 'idle';
    this.facing = 1; // 朝向：1 右 / -1 左

    this.el = document.createElement('div');
    this.el.className = 'pixel-figure';
    this.el.style.setProperty('--figure-color', this.color);
    // Minecraft 风格方块人：方头(带脸) + 躯干 + 左右臂 + 左右腿，走路时对角肢体摆动。
    // 纯 CSS 方块拼装、零外部图片；道具 emoji 拿在右手。
    this.el.innerHTML = `
      <span class="pf-name"></span>
      <div class="pf-bubble" hidden></div>
      <div class="pf-rig">
        <div class="pf-head"><span class="pf-face"></span></div>
        <div class="pf-torso">
          <div class="pf-arm pf-arm-l"></div>
          <div class="pf-arm pf-arm-r"><span class="pf-prop"></span></div>
        </div>
        <div class="pf-legs">
          <div class="pf-leg pf-leg-l"></div>
          <div class="pf-leg pf-leg-r"></div>
        </div>
      </div>
    `;
    this.nameEl = this.el.querySelector('.pf-name');
    this.bubbleEl = this.el.querySelector('.pf-bubble');
    this.faceEl = this.el.querySelector('.pf-face');
    this.propEl = this.el.querySelector('.pf-prop');
    this.nameEl.textContent = this.name;
    this.faceEl.textContent = this.face;
  }

  /** 同步后端共享事实（§19.3：是否在家由 home-interior 决定，这里只同步 status/name）。 */
  syncAgent(agent) {
    if (!agent) return;
    this.name = agent.name;
    this.status = agent.status;
    this.nameEl.textContent = this.name;
  }

  /** 设定当前动作并刷新道具 emoji（纯表现层）。 */
  setAction(action) {
    this.action = action;
    this.el.classList.remove(...ACTIONS.map((a) => `act-${a}`));
    this.el.classList.add(`act-${action}`);
    this.propEl.textContent = PROP_EMOJI[action] || '';
  }

  /** 定位到房间归一化坐标，并按 status 切表现态（active/asleep/isolated）。 */
  place() {
    this.el.style.left = `${this.x * 100}%`;
    this.el.style.top = `${this.y * 100}%`;
    this.el.style.setProperty('--facing', String(this.facing));
    this.el.classList.toggle('asleep', this.status === 'asleep');
    this.el.classList.toggle('isolated', this.status === 'isolated');
    this.el.classList.toggle('active', this.status === 'active');
  }

  /** 冒一句自言自语气泡（§19.3：asleep/isolated 不冒，由调用方把关）。 */
  say(text) {
    this.bubbleEl.textContent = text;
    this.bubbleEl.hidden = false;
    this.bubbleEl.classList.remove('pf-bubble-in');
    // 强制回流以重启动画
    void this.bubbleEl.offsetWidth;
    this.bubbleEl.classList.add('pf-bubble-in');
  }

  hideBubble() {
    this.bubbleEl.hidden = true;
  }

  destroy() {
    this.el.remove();
  }
}

// 动作对应的道具 emoji（§30.4 保留可辨识道具；walk/idle 无道具）。
const PROP_EMOJI = {
  type: '💻',
  water: '🌷',
  drink: '🥤',
  read: '📖',
  walk: '',
  idle: '',
};
