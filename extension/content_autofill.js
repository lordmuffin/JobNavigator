// extension/content_autofill.js
// Application Answer Autofill: anchors a Navigator button to focused application
// answer fields, extracts question/company/position context, asks the background
// service worker to generate an answer, and shows a review popover
// (Insert / Copy / Save to bank / Regenerate) before writing anything into the page.
(async () => {
  const cfg = await chrome.storage.sync.get(['autofillEnabled', 'autofillDefaultLength']);
  if (!cfg.autofillEnabled) return;
  const DEFAULT_LEN = parseInt(cfg.autofillDefaultLength, 10) || 250;  // popup-configurable

  const NAV_ICON = 'data:image/png;base64,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'; // real Navigator icon, inlined (no web-accessible resource)
  let host = null;      // shadow host for the button
  let popoverHost = null; // shadow host for the review popover
  let currentField = null;
  const fieldState = new Map(); // fieldKey(el) -> { text, error, busy, promise, maxChars } — keyed by a stable id so state survives the page re-rendering the field element

  const isAnswerField = (el) => {
    if (!el || el.readOnly || el.disabled) return false;
    // Skip searchable dropdowns / comboboxes / autocomplete pickers — many ATS build
    // these as a text <input>, which would otherwise match the free-text heuristic.
    if (el.getAttribute('role') === 'combobox' ||
        el.getAttribute('aria-autocomplete') ||
        el.getAttribute('aria-haspopup') === 'listbox' ||
        el.hasAttribute('list')) return false;
    return (el.tagName === 'TEXTAREA') ||
      (el.tagName === 'INPUT' && el.type === 'text' && (el.maxLength > 60 || el.maxLength === -1)) ||
      el.isContentEditable;
  };

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

  function fieldKey(el) {
    // Stable key so per-field state survives the page re-rendering the element.
    return el.id || el.name || (questionFor(el) ? 'q:' + questionFor(el) : 'autofill-field');
  }

  function removeButton() { if (host) { host.remove(); host = null; } }
  // Any teardown of the popover while its field is still generating leaves a
  // spinner badge on the field (focusout, click-outside, or being replaced all
  // route through here — so the "still working" indicator never gets skipped).
  function removePopover() {
    if (popoverHost) {
      const bi = popoverHost._busyInfo;
      if (bi && bi.st.busy) showBusyBadge(bi.el, bi.key);
      popoverHost.remove();
      popoverHost = null;
    }
  }

  // A field can be generating while its popover is closed — leave a spinner on it.
  const busyBadges = new Map(); // fieldKey -> host
  function removeBusyBadge(key) { const b = busyBadges.get(key); if (b) { b.remove(); busyBadges.delete(key); } }
  function showBusyBadge(el, key) {
    removeBusyBadge(key);
    const b = document.createElement('div');
    b.style.cssText = 'position:absolute;z-index:2147483647;pointer-events:none;width:24px;height:24px;';
    const root = b.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>.s{width:24px;height:24px;box-sizing:border-box;border:3px solid #3B82F6;' +
      'border-top-color:transparent;border-radius:50%;background:#fff;box-shadow:0 1px 5px rgba(0,0,0,.3);' +
      'animation:sp .7s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}</style><div class="s"></div>';
    const r = el.getBoundingClientRect();
    b.style.top = `${window.scrollY + r.bottom - 29}px`;
    b.style.left = `${window.scrollX + r.right - 25}px`;
    document.body.appendChild(b);
    busyBadges.set(key, b);
  }

  function showButton(el) {
    removeButton();
    removePopover();
    currentField = el;
    const key = fieldKey(el);
    removeBusyBadge(key);  // the button IS the indicator while the field is focused
    const busy = !!(fieldState.get(key) && fieldState.get(key).busy);
    host = document.createElement('div');
    // Invisible right-aligned rail: the pill sits at the field's bottom-right and
    // grows LEFTWARD on hover while its icon stays pinned to the corner. The rail
    // is pointer-events:none so its empty area never blocks clicks on the page.
    host.style.cssText = 'position:absolute;z-index:2147483647;display:flex;justify-content:flex-end;align-items:flex-end;width:270px;height:26px;pointer-events:none;';
    const root = host.attachShadow({ mode: 'open' });
    const inner = busy
      ? `<div class="btn spin" title="Generating…"><span class="sp"></span></div>`
      : `<button class="btn" title="Generate with JobNavigator"><img src="${NAV_ICON}" alt="Navigator"><span class="lbl">Generate with JobNavigator</span></button>`;
    root.innerHTML = `
      <style>
        .btn{pointer-events:auto;height:26px;display:flex;flex-direction:row-reverse;align-items:center;
             border-radius:13px;border:1px solid #3B82F6;background:#fff;cursor:pointer;
             box-shadow:0 1px 4px rgba(0,0,0,.2);overflow:hidden;padding:0;white-space:nowrap;
             max-width:26px;transition:max-width .4s cubic-bezier(.4,0,.2,1)}
        .btn:hover{max-width:260px}
        .btn img{width:18px;height:18px;margin:3px;flex:0 0 auto}
        .btn .lbl{font:600 12px system-ui;color:#3B82F6;padding:0 4px 0 10px;flex:0 0 auto}
        .btn.spin{justify-content:center;max-width:26px}
        .btn.spin:hover{max-width:26px}
        .btn.spin .sp{width:14px;height:14px;box-sizing:border-box;border:2px solid #3B82F6;
              border-top-color:transparent;border-radius:50%;margin:3px;animation:sp .7s linear infinite}
        @keyframes sp{to{transform:rotate(360deg)}}
      </style>
      ${inner}`;
    const r = el.getBoundingClientRect();
    // 3px inset from the field's bottom-right corner.
    host.style.top = `${window.scrollY + r.bottom - 29}px`;
    host.style.left = `${window.scrollX + r.right - 273}px`;  // rail right edge = field right - 3px
    document.body.appendChild(host);
    root.querySelector('.btn').addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      onGenerate(el);  // clicking the spinner re-opens the popover, which shows the live loader
    });
  }

  function onGenerate(el) {
    const fieldMax = maxCharsFor(el);
    const key = fieldKey(el);
    let st = fieldState.get(key);
    if (!st) {
      st = { text: null, error: null, busy: false, promise: null, maxChars: fieldMax || DEFAULT_LEN };
      fieldState.set(key, st);
    }
    showPopover(el, { question: questionFor(el), company: pageCompany(), position: pagePosition(), fieldMax }, st);
  }

  function showPopover(el, ctx, st) {
    removeButton();
    removePopover();
    const key = fieldKey(el);
    removeBusyBadge(key);  // popover is open now; no need for the standalone spinner
    // While the popover is open, the field is no longer "current" for the
    // scroll handler's button-repositioning logic - otherwise scrolling would
    // spawn a second floating button next to the open popover.
    currentField = null;
    const pop = document.createElement('div');
    pop.style.cssText = 'position:absolute;z-index:2147483647;';
    const root = pop.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .card{width:720px;max-width:92vw;background:#111827;color:#fff;border-radius:10px;
              padding:12px;box-shadow:0 6px 24px rgba(0,0,0,.35);font:13px system-ui}
        textarea{width:100%;min-height:150px;background:#1f2937;color:#fff;border:1px solid #374151;
                 border-radius:6px;padding:8px;box-sizing:border-box;resize:vertical}
        .row{display:flex;gap:8px;margin-top:8px;align-items:center;flex-wrap:wrap}
        button{border:0;border-radius:6px;padding:6px 10px;cursor:pointer;font-weight:600}
        button:disabled{opacity:.5;cursor:default}
        label{color:#9CA3AF;display:flex;align-items:center;gap:4px}
        input[type=number]{width:64px;background:#1f2937;color:#fff;border:1px solid #374151;
               border-radius:6px;padding:5px 6px;font:13px system-ui}
        .primary{background:#3B82F6;color:#fff}.ghost{background:#374151;color:#fff}
        .count{margin-left:auto;color:#9CA3AF}
        .spin{width:13px;height:13px;border:2px solid #9CA3AF;border-top-color:transparent;
              border-radius:50%;display:inline-block;animation:sp .7s linear infinite;vertical-align:middle;margin-right:5px}
        @keyframes sp{to{transform:rotate(360deg)}}
      </style>
      <div class="card">
        <textarea id="ans" readonly placeholder="Generating…"></textarea>
        <div class="row">
          <label>Length <input id="len" type="number" min="50" max="4000" step="50" value="${st.maxChars}"> chars</label>
          <button class="primary" id="insert" disabled>Insert</button>
          <button class="ghost" id="copy" disabled>Copy</button>
          <button class="ghost" id="save" disabled>Save to bank</button>
          <button class="ghost" id="regen" disabled>Regenerate</button>
          <span class="count" id="count"></span>
        </div>
      </div>`;
    const r = el.getBoundingClientRect();
    pop.style.top = `${window.scrollY + r.bottom + 6}px`;
    pop.style.left = `${window.scrollX + r.left}px`;
    document.body.appendChild(pop);
    popoverHost = pop;
    pop._busyInfo = { el, key, st };  // lets removePopover() badge the field if torn down mid-generation

    const ta = root.getElementById('ans');
    const count = root.getElementById('count');
    const lenInp = root.getElementById('len');
    const saveBtn = root.getElementById('save');
    const actionBtns = ['insert', 'copy', 'save', 'regen'].map(id => root.getElementById(id));
    const upd = () => { count.textContent = `${ta.value.length}/${st.maxChars}`; };
    ta.addEventListener('input', () => { upd(); st.text = ta.value; });  // persist edits per field
    // Focus so the popover keeps focus (the button that opened it was just removed;
    // otherwise the focusout handler tears the popover down ~150ms later).
    ta.focus();

    const setBusy = (busy) => {
      actionBtns.forEach(b => { b.disabled = busy; });
      ta.readOnly = busy;
      if (busy) { ta.value = ''; count.innerHTML = '<span class="spin"></span>Generating…'; }
    };

    const render = () => {
      setBusy(false);
      if (st.text != null) { ta.value = st.text; upd(); ta.focus(); }
      else { ta.value = ''; count.textContent = 'Failed: ' + (st.error || 'unknown'); }
    };

    const generate = async () => {
      setBusy(true);
      // Keep focus in the popover: setBusy disables the action buttons, and if one
      // (e.g. Regenerate) was focused, blurring it would drop focus to <body> and the
      // focusout handler would close the popover mid-generation.
      ta.focus();
      saveBtn.textContent = 'Save to bank';
      st.busy = true; st.text = null; st.error = null;
      const p = chrome.runtime.sendMessage({
        type: 'autofill_generate',
        question: ctx.question, company: ctx.company, position: ctx.position,
        max_chars: st.maxChars,
      });
      st.promise = p;
      const resp = await p;
      // Store the result on the field even if this popover was closed meanwhile,
      // so reopening the same field shows it instead of regenerating from scratch.
      st.busy = false;
      if (resp && resp.answer) { st.text = resp.answer; st.error = null; }
      else { st.text = null; st.error = (resp && resp.error) || 'unknown'; }
      removeBusyBadge(key);  // generation finished; drop the field spinner if the popover was closed
      if (popoverHost === pop) render();
    };

    // Route through removePopover so the busy badge (if generating) is shown.
    const close = () => { if (popoverHost === pop) removePopover(); else pop.remove(); };
    root.getElementById('insert').onclick = () => { fillField(el, ta.value); close(); };
    root.getElementById('copy').onclick = () => navigator.clipboard.writeText(ta.value);
    saveBtn.onclick = async () => {
      const resp = await chrome.runtime.sendMessage({ type: 'autofill_save', question: ctx.question, answer: ta.value });
      const ok = resp && resp.count !== undefined && !resp.error;
      saveBtn.textContent = ok ? 'Saved' : 'Save failed';
    };
    root.getElementById('regen').onclick = generate;
    lenInp.addEventListener('change', () => {
      const v = parseInt(lenInp.value, 10);
      if (v > 0) { st.maxChars = v; generate(); }
    });
    document.addEventListener('mousedown', function onOut(ev) {
      if (!pop.contains(ev.target)) { close(); document.removeEventListener('mousedown', onOut); }
    });

    // Restore the field's prior state instead of always regenerating.
    if (st.busy && st.promise) {
      setBusy(true);                                   // a generation is still in flight
      st.promise.then(() => { if (popoverHost === pop) render(); });
    } else if (st.text != null) {
      render();                                        // show the answer we already have
    } else {
      generate();                                      // first time for this field
    }
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
