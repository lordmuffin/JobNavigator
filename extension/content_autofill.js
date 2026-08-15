// extension/content_autofill.js
// Application Answer Autofill: anchors a Navigator button to focused application
// answer fields, extracts question/company/position context, asks the background
// service worker to generate an answer, and shows a review popover
// (Insert / Copy / Save to bank / Regenerate) before writing anything into the page.
(async () => {
  const { autofillEnabled } = await chrome.storage.sync.get(['autofillEnabled']);
  if (!autofillEnabled) return;

  const ICON_URL = chrome.runtime.getURL('icons/icon48.png');
  let host = null;      // shadow host for the button
  let popoverHost = null; // shadow host for the review popover
  let currentField = null;

  const isAnswerField = (el) =>
    el && !el.readOnly && !el.disabled &&
    ((el.tagName === 'TEXTAREA') ||
     (el.tagName === 'INPUT' && el.type === 'text' && (el.maxLength > 60 || el.maxLength === -1)) ||
     el.isContentEditable);

  function questionFor(el) {
    // label[for=id] -> aria-labelledby -> aria-label -> placeholder -> nearest preceding text
    if (el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab) return lab.innerText.trim();
    }
    const ariaId = el.getAttribute('aria-labelledby');
    if (ariaId) { const n = document.getElementById(ariaId); if (n) return n.innerText.trim(); }
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();
    if (el.placeholder) return el.placeholder.trim();
    let p = el.closest('label') || el.parentElement;
    for (let i = 0; p && i < 4; i++, p = p.parentElement) {
      const t = (p.innerText || '').trim();
      if (t && t.length < 300) return t.split('\n')[0].trim();
    }
    return '';
  }

  function pageCompany() {
    // JSON-LD JobPosting -> og:site_name -> hostname
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const j = JSON.parse(s.textContent);
        const o = Array.isArray(j) ? j.find(x => x['@type'] === 'JobPosting') : j;
        if (o && o.hiringOrganization && o.hiringOrganization.name) return o.hiringOrganization.name;
      } catch {}
    }
    const og = document.querySelector('meta[property="og:site_name"]');
    return (og && og.content) || location.hostname.replace(/^www\./, '');
  }

  function pagePosition() {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const j = JSON.parse(s.textContent);
        const o = Array.isArray(j) ? j.find(x => x['@type'] === 'JobPosting') : j;
        if (o && o.title) return o.title;
      } catch {}
    }
    const og = document.querySelector('meta[property="og:title"]');
    return (og && og.content) || document.title;
  }

  function maxCharsFor(el) {
    if (el.maxLength && el.maxLength > 0) return el.maxLength;
    return null;  // background/backend applies the default from settings
  }

  function removeButton() { if (host) { host.remove(); host = null; } }
  function removePopover() { if (popoverHost) { popoverHost.remove(); popoverHost = null; } }

  function showButton(el) {
    removeButton();
    removePopover();
    currentField = el;
    host = document.createElement('div');
    host.style.cssText = 'position:absolute;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .btn{width:26px;height:26px;border-radius:6px;border:1px solid #3B82F6;background:#fff;
             cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.2)}
        .btn img{width:16px;height:16px}
      </style>
      <button class="btn" title="Fill with JobNavigator"><img src="${ICON_URL}"></button>`;
    const r = el.getBoundingClientRect();
    host.style.top = `${window.scrollY + r.top + 4}px`;
    host.style.left = `${window.scrollX + r.right - 30}px`;
    document.body.appendChild(host);
    root.querySelector('.btn').addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      onGenerate(el);
    });
  }

  async function onGenerate(el) {
    const fieldMax = maxCharsFor(el);
    const payload = {
      type: 'autofill_generate',
      question: questionFor(el),
      company: pageCompany(),
      position: pagePosition(),
      max_chars: fieldMax,
    };
    const resp = await chrome.runtime.sendMessage(payload);
    if (resp && resp.answer) {
      showPopover(el, resp.answer, { question: payload.question, max: payload.max_chars, payload, fieldMax });
    } else {
      alert('Autofill failed: ' + ((resp && resp.error) || 'unknown'));
    }
  }

  function showPopover(el, answer, ctx) {
    removeButton();
    removePopover();
    // While the popover is open, the field is no longer "current" for the
    // scroll handler's button-repositioning logic - otherwise scrolling would
    // spawn a second floating button next to the open popover.
    currentField = null;
    const pop = document.createElement('div');
    pop.style.cssText = 'position:absolute;z-index:2147483647;';
    const root = pop.attachShadow({ mode: 'open' });
    const lengthOptions = [];
    if (ctx.fieldMax) lengthOptions.push({ value: 'field', label: 'Field limit' });
    lengthOptions.push({ value: 'default', label: 'Settings default' });
    lengthOptions.push({ value: '250', label: '~250' });
    lengthOptions.push({ value: '600', label: '~600' });
    lengthOptions.push({ value: '1200', label: '~1200' });
    const initialLen = ctx.fieldMax ? 'field' : 'default';
    root.innerHTML = `
      <style>
        .card{width:360px;max-width:80vw;background:#111827;color:#fff;border-radius:10px;
              padding:12px;box-shadow:0 6px 24px rgba(0,0,0,.35);font:13px system-ui}
        textarea{width:100%;min-height:120px;background:#1f2937;color:#fff;border:1px solid #374151;
                 border-radius:6px;padding:8px;box-sizing:border-box;resize:vertical}
        .row{display:flex;gap:8px;margin-top:8px;align-items:center;flex-wrap:wrap}
        button{border:0;border-radius:6px;padding:6px 10px;cursor:pointer;font-weight:600}
        select{background:#1f2937;color:#fff;border:1px solid #374151;border-radius:6px;
               padding:5px 6px;font:13px system-ui}
        .primary{background:#3B82F6;color:#fff}.ghost{background:#374151;color:#fff}
        .count{margin-left:auto;color:#9CA3AF}
      </style>
      <div class="card">
        <textarea id="ans">${answer.replace(/</g, '&lt;')}</textarea>
        <div class="row">
          <select id="len" title="Answer length">
            ${lengthOptions.map(o => `<option value="${o.value}"${o.value === initialLen ? ' selected' : ''}>${o.label}</option>`).join('')}
          </select>
          <button class="primary" id="insert">Insert</button>
          <button class="ghost" id="copy">Copy</button>
          <button class="ghost" id="save">Save to bank</button>
          <button class="ghost" id="regen">Regenerate</button>
          <span class="count" id="count"></span>
        </div>
      </div>`;
    const r = el.getBoundingClientRect();
    pop.style.top = `${window.scrollY + r.bottom + 6}px`;
    pop.style.left = `${window.scrollX + r.left}px`;
    document.body.appendChild(pop);
    popoverHost = pop;

    const ta = root.getElementById('ans');
    const count = root.getElementById('count');
    const lenSel = root.getElementById('len');
    const upd = () => { count.textContent = ctx.max ? `${ta.value.length}/${ctx.max}` : `${ta.value.length}`; };
    ta.addEventListener('input', upd); upd();

    const resolveMaxChars = (val) => {
      if (val === 'field') return ctx.fieldMax;
      if (val === 'default') return null;
      return parseInt(val, 10);
    };

    const close = () => { pop.remove(); if (popoverHost === pop) popoverHost = null; };
    root.getElementById('insert').onclick = () => { fillField(el, ta.value); close(); };
    root.getElementById('copy').onclick = () => navigator.clipboard.writeText(ta.value);
    root.getElementById('save').onclick = async () => {
      await chrome.runtime.sendMessage({ type: 'autofill_save', question: ctx.question, answer: ta.value });
      root.getElementById('save').textContent = 'Saved';
    };
    root.getElementById('regen').onclick = async () => {
      const resp = await chrome.runtime.sendMessage(ctx.payload);
      if (resp && resp.answer) { ta.value = resp.answer; upd(); }
    };
    lenSel.addEventListener('change', async () => {
      const chosen = resolveMaxChars(lenSel.value);
      ctx.max = chosen;
      ctx.payload.max_chars = chosen;
      upd();
      const resp = await chrome.runtime.sendMessage(ctx.payload);
      if (resp && resp.answer) { ta.value = resp.answer; upd(); }
    });
    document.addEventListener('mousedown', function onOut(ev) {
      if (!pop.contains(ev.target)) { close(); document.removeEventListener('mousedown', onOut); }
    });
  }

  function fillField(el, value) {
    if (el.isContentEditable) {
      el.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, value);  // works for most contenteditable; Draft/Slate deferred to v2
    } else {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  document.addEventListener('focusin', (e) => {
    if (isAnswerField(e.target)) showButton(e.target);
  }, true);
  document.addEventListener('focusout', () => {
    // keep the button/popover if focus moved into their own shadow host
    setTimeout(() => {
      const active = document.activeElement;
      if (host && active !== currentField && !host.contains(active)) removeButton();
      if (popoverHost && active !== currentField && !popoverHost.contains(active)) removePopover();
    }, 150);
  }, true);
  // Scroll only repositions the button, and only while no popover is open
  // (the popover's field is cleared from currentField above, so this is a
  // no-op then - re-showing the button on scroll would otherwise spawn a
  // second floating widget next to the open popover).
  window.addEventListener('scroll', () => { if (currentField) showButton(currentField); }, true);
})();
