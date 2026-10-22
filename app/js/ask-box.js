// 游客提问输入框（design §10、视觉风格 §5）。
// 轻量前置禁用（空/超长），真正校验以后端为准；按帧名区分反馈：
//   ask_queued 视为成功（提示已排队、可显示 position）；
//   ask_rejected 视为失败（渲染 message、说明本次无决议）。两类均不改共享状态。

export class AskBox {
  constructor({ inputEl, sendEl, hintEl }, ws) {
    this.input = inputEl;
    this.send = sendEl;
    this.hint = hintEl;
    this.ws = ws;

    this.input.addEventListener('input', () => this._refresh());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._submit();
    });
    this.send.addEventListener('click', () => this._submit());
    this._refresh();
  }

  _refresh() {
    const v = this.input.value.trim();
    this.send.disabled = v.length === 0 || v.length > 200;
  }

  _submit() {
    const v = this.input.value.trim();
    if (v.length === 0 || v.length > 200) return;
    this.ws.send('visitor_ask', { question: v });
    this.input.value = '';
    this._refresh();
    this._setHint('已广播，等待公民们开始讨论……', true);
  }

  /** 收到 ask_queued：成功语义。 */
  onQueued(data) {
    const pos = data && data.position;
    const msg = (data && data.message) || '已为你排队~';
    this._setHint(pos ? `${msg}（排队第 ${pos} 位，稍后出决议）` : msg, true);
  }

  /** 收到 ask_rejected：失败语义。 */
  onRejected(data) {
    const msg = (data && data.message) || '这个问题暂时没法讨论，换一个吧~';
    this._setHint(`${msg}（本次不会产出决议）`, false);
  }

  _setHint(text, ok) {
    this.hint.textContent = text;
    this.hint.classList.toggle('ok', !!ok);
  }
}
