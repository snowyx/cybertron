// 实时事件流面板（产品级重构）。
// 渲染 agent_event / discussion_speak / discussion_start / resolution：
//   - 每条带 agent 专属强调色（由 agentId 确定性派生，与地图/小人一致）
//   - 头像块 + 时间戳 + 入场动效（CSS feedIn）
//   - 决议卡片：告警橙渐变描边高亮
//   - 支持按 data-filter 筛选（全部 / 生活 / 讨论 / 决议）

import { hashId, PALETTE } from './pixel-figure.js';

const MAX_ITEMS = 60;

/** agentId → 确定性强调色（与像素小人同源，保证跨视图一致）。 */
function accentFor(agentId) {
  const h = hashId(String(agentId ?? 'system'));
  return PALETTE[h % PALETTE.length];
}

/** 名字 → 头像两字符缩写。 */
function initialsOf(name) {
  const s = String(name || '').trim();
  if (!s) return '✦';
  const cleaned = s.replace(/[^A-Za-z0-9\u4e00-\u9fa5]/g, '');
  return cleaned ? cleaned.slice(0, 2).toUpperCase() : '✦';
}

function timeLabel(ts) {
  const d = ts ? new Date(ts) : new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}

export class EventFeed {
  constructor(listEl) {
    this.list = listEl;
  }

  /** 全量回灌（新连接拿到 recentEvents 时补上下文）。 */
  seed(recentEvents) {
    this.list.innerHTML = '';
    for (const ev of recentEvents || []) {
      if (ev.kind === 'resolution') {
        this.addResolution({ text: ev.text, ts: ev.ts });
      } else if (ev.kind === 'speak') {
        this.addSpeak({ agentId: ev.agentId, name: ev.name, text: ev.text, ts: ev.ts });
      } else {
        this.addEvent({ agentId: ev.agentId, name: ev.name, kind: ev.kind, text: ev.text, ts: ev.ts });
      }
    }
  }

  /** 追加 + 上限裁剪 + 智能滚动（用户上翻浏览时不强行拉底）。 */
  _append(li) {
    const nearBottom =
      this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 80;
    this.list.appendChild(li);
    while (this.list.children.length > MAX_ITEMS) {
      this.list.removeChild(this.list.firstChild);
    }
    if (nearBottom) this.list.scrollTop = this.list.scrollHeight;
  }

  _make({ bucket, accent, name, text, ts, html, isReply = false }) {
    const li = document.createElement('li');
    li.className = 'feed-item';
    li.dataset.bucket = bucket;
    li.style.setProperty('--feed-accent', accent);
    if (isReply) li.classList.add('interaction-reply');
    li.innerHTML = `
      <span class="feed-avatar">${esc(initialsOf(name))}</span>
      <div class="feed-body">${html || `<span class="feed-who">${esc(name)}</span>${esc(text)}`}</div>
      <time class="feed-time">${timeLabel(ts)}</time>
    `;
    return li;
  }

  /** 自主生活事件（act / talk / visit / build…）。 */
  addEvent({ name, text, interaction, agentId, kind, ts }) {
    const li = this._make({
      bucket: 'life',
      accent: accentFor(agentId),
      name,
      text,
      ts,
      isReply: !!(interaction && interaction.replyTo),
    });
    this._append(li);
  }

  /** 讨论发言。 */
  addSpeak({ name, text, agentId, ts }) {
    const li = this._make({
      bucket: 'talk',
      accent: accentFor(agentId),
      name,
      text,
      ts,
    });
    li.classList.add('speak');
    this._append(li);
  }

  /** 讨论开场（游客提问被受理）。 */
  addStart({ question }) {
    const li = this._make({
      bucket: 'talk',
      accent: 'var(--neon-violet)',
      name: '星城',
      html: `公民们开始讨论：「${esc(question)}」`,
      ts: Date.now(),
    });
    li.classList.add('start');
    this._append(li);
  }

  /** 赛博坦决议（每场讨论恰一条）。 */
  addResolution({ text, ts }) {
    const li = this._make({
      bucket: 'resolution',
      accent: 'var(--alert-orange)',
      name: '决议',
      html: `<span class="feed-who">赛博坦决议</span>${esc(text)}`,
      ts,
    });
    li.classList.add('resolution');
    this._append(li);
  }
}
