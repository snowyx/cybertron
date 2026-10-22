// 实时事件流面板（design §10、视觉风格 §5）。
// 渲染 agent_event / discussion_speak / discussion_start；resolution 用告警橙高亮
// 「赛博坦决议」卡片，与普通发言明显区分。

const MAX_ITEMS = 60;

export class EventFeed {
  constructor(listEl) {
    this.list = listEl;
  }

  /** 全量回灌（新连接拿到 recentEvents 时补上下文）。 */
  seed(recentEvents) {
    this.list.innerHTML = '';
    for (const ev of recentEvents || []) {
      if (ev.kind === 'resolution') {
        this.addResolution({ text: ev.text });
      } else if (ev.kind === 'speak') {
        this.addSpeak({ name: ev.name, text: ev.text });
      } else {
        this.addEvent({ name: ev.name, text: ev.text });
      }
    }
  }

  _append(li) {
    this.list.appendChild(li);
    while (this.list.children.length > MAX_ITEMS) {
      this.list.removeChild(this.list.firstChild);
    }
    this.list.scrollTop = this.list.scrollHeight;
  }

  addEvent({ name, text, interaction }) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="who">${esc(name)}</span> ${esc(text)}`;
    // 带 interaction.replyTo 的回应项：缩进 + 连线样式（纯 CSS，§22.4）。
    if (interaction && interaction.replyTo) {
      li.classList.add('interaction-reply');
    }
    this._append(li);
  }

  addSpeak({ name, text }) {
    const li = document.createElement('li');
    li.className = 'speak';
    li.innerHTML = `<span class="who">${esc(name)}</span>：${esc(text)}`;
    this._append(li);
  }

  addStart({ question }) {
    const li = document.createElement('li');
    li.className = 'start';
    li.textContent = `💬 公民们开始讨论：「${question}」`;
    this._append(li);
  }

  addResolution({ text }) {
    const li = document.createElement('li');
    li.className = 'resolution';
    li.innerHTML = `<span class="who">🔮 赛博坦决议</span><br>${esc(text)}`;
    this._append(li);
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}
