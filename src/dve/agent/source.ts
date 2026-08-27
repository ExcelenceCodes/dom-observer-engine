/**
 * DVE in-page agent.
 *
 * Injected via Playwright's addInitScript into EVERY frame, before application
 * code runs. Written as a plain ES5-compatible IIFE string so it needs no
 * bundler and cannot pull framework code into the target page.
 *
 * Isolation rules enforced here:
 *  - single non-enumerable global (window.__dve)
 *  - all overlays live inside one shadow root on one host element
 *  - the host element is excluded from every scan
 *  - dispose() removes everything, leaving the page byte-identical
 *
 * NOTE: the body below must not contain backticks or ${ } sequences.
 */
export const DVE_AGENT_SOURCE = `
(function () {
  if (window.__dve) return;

  var OVERLAY_ATTR = 'data-dve-overlay';
  var CANDIDATE_SELECTOR = [
    'a[href]', 'button', 'input', 'select', 'textarea', 'form', 'label',
    'table', 'ul', 'ol', 'li', 'dialog', 'details', 'summary', 'iframe',
    'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'nav', 'main', 'aside',
    'header', 'footer', 'section[aria-label]', 'section[aria-labelledby]',
    '[role]', '[tabindex]', '[contenteditable=""]', '[contenteditable="true"]',
    '[aria-live]', '[aria-modal]', '[data-toast]', '[data-testid]'
  ].join(',');

  var byId = Object.create(null);
  var idAttr = new WeakMap();
  var lastSet = Object.create(null);
  var epoch = 1;
  var frameId = 'pending';
  var pending = null;
  var scanCount = 0;
  var overlayHost = null;
  var overlayRoot = null;
  var cursorEl = null;
  var cursorPos = { x: -100, y: -100 };
  var highlights = [];
  var disposed = false;

  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h.toString(36);
  }

  function isOverlayNode(el) {
    return !!(el && el.closest && el.closest('[' + OVERLAY_ATTR + ']'));
  }

  function domPath(el) {
    var parts = [];
    var node = el;
    var guard = 0;
    while (node && node.nodeType === 1 && guard++ < 60) {
      var tag = node.tagName.toLowerCase();
      var parent = node.parentElement;
      if (!parent) { parts.unshift(tag); break; }
      var idx = 1;
      var sib = node;
      while ((sib = sib.previousElementSibling)) {
        if (sib.tagName === node.tagName) idx++;
      }
      parts.unshift(tag + '[' + idx + ']');
      node = parent;
    }
    return parts.join('/');
  }

  function textOf(el) {
    var t = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    return t.length > 200 ? t.slice(0, 200) : t;
  }

  function labelFor(el) {
    if (el.id) {
      var lab = el.ownerDocument.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (lab) return textOf(lab);
    }
    var wrap = el.closest ? el.closest('label') : null;
    if (wrap) return textOf(wrap);
    return '';
  }

  function accessibleName(el) {
    var aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria) return aria.trim();
    var lb = el.getAttribute && el.getAttribute('aria-labelledby');
    if (lb) {
      var names = [];
      lb.split(/\\s+/).forEach(function (ref) {
        var t = el.ownerDocument.getElementById(ref);
        if (t) names.push(textOf(t));
      });
      if (names.length) return names.join(' ').trim();
    }
    var tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      var l = labelFor(el);
      if (l) return l;
      var ph = el.getAttribute('placeholder');
      if (ph) return ph;
      if (el.type === 'submit' || el.type === 'button') return el.value || '';
      var nm = el.getAttribute('name');
      if (nm) return nm;
    }
    if (tag === 'img') return el.getAttribute('alt') || '';
    var title = el.getAttribute('title');
    var txt = textOf(el);
    if (txt && txt.length <= 120) return txt;
    return title || '';
  }

  function roleOf(el) {
    var explicit = el.getAttribute && el.getAttribute('role');
    if (explicit) return explicit.trim().split(/\\s+/)[0];
    var tag = el.tagName.toLowerCase();
    var type = (el.getAttribute && el.getAttribute('type') || '').toLowerCase();
    switch (tag) {
      case 'a': return el.hasAttribute('href') ? 'link' : 'generic';
      case 'button': return 'button';
      case 'select': return el.multiple ? 'listbox' : 'combobox';
      case 'textarea': return 'textbox';
      case 'form': return 'form';
      case 'table': return 'table';
      case 'ul': case 'ol': return 'list';
      case 'li': return 'listitem';
      case 'dialog': return 'dialog';
      case 'nav': return 'navigation';
      case 'main': return 'main';
      case 'header': return 'banner';
      case 'footer': return 'contentinfo';
      case 'aside': return 'complementary';
      case 'section': return 'region';
      case 'img': return 'img';
      case 'iframe': return 'iframe';
      case 'summary': return 'button';
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading';
      case 'input':
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
        if (type === 'range') return 'slider';
        if (type === 'search') return 'searchbox';
        return 'textbox';
      default: return 'generic';
    }
  }

  function typeOf(el, role) {
    var tag = el.tagName.toLowerCase();
    var type = (el.getAttribute('type') || '').toLowerCase();
    if (role === 'checkbox' || role === 'switch') return 'checkbox';
    if (role === 'radio') return 'radio';
    if (role === 'button') return 'button';
    if (role === 'link') return 'link';
    if (role === 'combobox' || role === 'listbox') return tag === 'select' ? 'select' : 'other';
    if (role === 'tab') return 'tab';
    if (role === 'menuitem' || role === 'menuitemcheckbox') return 'menuitem';
    if (role === 'menu' || role === 'menubar') return 'menu';
    if (role === 'dialog' || role === 'alertdialog') return 'dialog';
    if (role === 'alert') return isToast(el) ? 'toast' : 'alert';
    if (role === 'status') return 'toast';
    if (role === 'banner') return 'banner';
    if (role === 'heading') return 'heading';
    if (role === 'img') return 'image';
    if (role === 'table' || role === 'grid') return 'table';
    if (role === 'list') return 'list';
    if (role === 'listitem') return 'listitem';
    if (tag === 'form') return 'form';
    if (tag === 'textarea') return 'textarea';
    if (tag === 'select') return 'select';
    if (tag === 'input') {
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
      return 'input';
    }
    if (isToast(el)) return 'toast';
    if (role === 'region' || role === 'navigation' || role === 'main' || role === 'complementary') return 'region';
    return 'other';
  }

  function isToast(el) {
    if (el.hasAttribute('data-toast')) return true;
    var live = el.getAttribute('aria-live');
    if (live === 'polite' || live === 'assertive') return true;
    var cls = (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || '';
    return typeof cls === 'string' && /(^|[\\s_-])toast|snackbar|notification($|[\\s_-])/i.test(cls);
  }

  function isModal(el) {
    if (el.getAttribute('aria-modal') === 'true') return true;
    if (el.tagName.toLowerCase() === 'dialog' && el.hasAttribute('open')) return true;
    var role = el.getAttribute('role');
    return role === 'dialog' || role === 'alertdialog';
  }

  function visibilityOf(el) {
    var rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { visible: false, rect: rect };
    var style = el.ownerDocument.defaultView.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
      return { visible: false, rect: rect };
    }
    if (parseFloat(style.opacity || '1') === 0) return { visible: false, rect: rect };
    if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') {
      return { visible: false, rect: rect };
    }
    return { visible: true, rect: rect };
  }

  function isEnabled(el) {
    if (el.disabled === true) return false;
    if (el.getAttribute('aria-disabled') === 'true') return false;
    if (el.closest && el.closest('fieldset[disabled]')) return false;
    return true;
  }

  function inViewportOf(rect) {
    var vw = window.innerWidth, vh = window.innerHeight;
    return rect.bottom > 0 && rect.right > 0 && rect.top < vh && rect.left < vw;
  }

  function occludedAt(el, rect) {
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) return false;
    var hit = document.elementFromPoint(cx, cy);
    if (!hit) return true;
    if (isOverlayNode(hit)) return false;
    return !(hit === el || el.contains(hit) || hit.contains(el));
  }

  function scrollable(el) {
    var style = getComputedStyle(el);
    var oy = style.overflowY, ox = style.overflowX;
    return ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) ||
           ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 1);
  }

  function idFor(el) {
    var known = idAttr.get(el);
    if (known && byId[known] === el) return known;
    var role = roleOf(el);
    var seed = domPath(el) + '|' + el.tagName + '|' + role + '|' + accessibleName(el).slice(0, 60);
    var id = 'dve_' + hash(seed);
    var n = 0;
    while (byId[id] && byId[id] !== el && byId[id].isConnected) {
      n++;
      id = 'dve_' + hash(seed + '#' + n);
    }
    byId[id] = el;
    idAttr.set(el, id);
    return id;
  }

  function refOf(el, id) {
    var role = roleOf(el);
    var vis = visibilityOf(el);
    var rect = vis.rect;
    var sx = window.scrollX || 0, sy = window.scrollY || 0;
    var tag = el.tagName.toLowerCase();
    var ref = {
      id: id || idFor(el),
      type: typeOf(el, role),
      role: role,
      name: accessibleName(el),
      text: textOf(el),
      visible: vis.visible,
      inViewport: vis.visible && inViewportOf(rect),
      occluded: vis.visible ? occludedAt(el, rect) : false,
      enabled: isEnabled(el),
      focused: el === document.activeElement,
      bounds: {
        x: Math.round((rect.left + sx) * 100) / 100,
        y: Math.round((rect.top + sy) * 100) / 100,
        width: Math.round(rect.width * 100) / 100,
        height: Math.round(rect.height * 100) / 100
      },
      frameId: frameId,
      epoch: epoch
    };
    if (tag === 'input' || tag === 'textarea' || tag === 'select') ref.value = String(el.value == null ? '' : el.value);
    if (el.type === 'checkbox' || el.type === 'radio') ref.checked = !!el.checked;
    else if (el.getAttribute('aria-checked')) ref.checked = el.getAttribute('aria-checked') === 'true';
    if (!ref.text) delete ref.text;
    return ref;
  }

  function candidates() {
    scanCount++;
    var out = [];
    var nodes = document.querySelectorAll(CANDIDATE_SELECTOR);
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (isOverlayNode(el)) continue;
      out.push(el);
      if (el.shadowRoot) collectShadow(el.shadowRoot, out);
    }
    return out;
  }

  function collectShadow(root, out) {
    var nodes = root.querySelectorAll(CANDIDATE_SELECTOR);
    for (var i = 0; i < nodes.length; i++) {
      out.push(nodes[i]);
      if (nodes[i].shadowRoot) collectShadow(nodes[i].shadowRoot, out);
    }
  }

  function scan() {
    var els = candidates();
    var next = Object.create(null);
    for (var i = 0; i < els.length; i++) {
      var id = idFor(els[i]);
      next[id] = els[i];
    }
    for (var key in byId) {
      if (!next[key] && !byId[key].isConnected) delete byId[key];
    }
    return next;
  }

  function matches(el, ref, spec) {
    if (spec.type) {
      var types = Array.isArray(spec.type) ? spec.type : [spec.type];
      if (types.indexOf(ref.type) === -1) return false;
    }
    if (spec.role) {
      var roles = Array.isArray(spec.role) ? spec.role : [spec.role];
      if (roles.indexOf(ref.role) === -1) return false;
    }
    if (spec.tag && el.tagName.toLowerCase() !== spec.tag.toLowerCase()) return false;
    if (spec.name && ref.name.toLowerCase().indexOf(spec.name.toLowerCase()) === -1) return false;
    if (spec.text) {
      var hay = ((ref.text || '') + ' ' + ref.name).toLowerCase();
      if (hay.indexOf(spec.text.toLowerCase()) === -1) return false;
    }
    if (spec.attributes) {
      for (var a in spec.attributes) {
        if (el.getAttribute(a) !== spec.attributes[a]) return false;
      }
    }
    if (spec.visible !== undefined && ref.visible !== spec.visible) return false;
    if (spec.inViewport !== undefined && ref.inViewport !== spec.inViewport) return false;
    if (spec.enabled !== undefined && ref.enabled !== spec.enabled) return false;
    if (spec.focused !== undefined && ref.focused !== spec.focused) return false;
    if (spec.interactive) {
      var it = ['button', 'link', 'input', 'textarea', 'select', 'checkbox', 'radio', 'tab', 'menuitem'];
      var tabbable = el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1';
      if (it.indexOf(ref.type) === -1 && !tabbable) return false;
    }
    if (spec.viewport) {
      var vh = window.innerHeight, vw = window.innerWidth;
      var top = ref.bounds.y - (window.scrollY || 0);
      var left = ref.bounds.x - (window.scrollX || 0);
      var pct = spec.viewport.pct / 100;
      if (spec.viewport.band === 'top' && !(top < vh * pct)) return false;
      if (spec.viewport.band === 'bottom' && !(top >= vh * (1 - pct))) return false;
      if (spec.viewport.band === 'left' && !(left < vw * pct)) return false;
      if (spec.viewport.band === 'right' && !(left >= vw * (1 - pct))) return false;
    }
    if (spec.relativeTo) {
      var anchor = byId[spec.relativeTo.id];
      if (!anchor || !anchor.isConnected) return false;
      if (anchor === el) return false;
      var ar = refOf(anchor).bounds;
      var br = ref.bounds;
      var pad = spec.relativeTo.withinPx == null ? 150 : spec.relativeTo.withinPx;
      var rel = spec.relativeTo.relation;
      if (rel === 'inside') { if (!anchor.contains(el)) return false; }
      else if (rel === 'above') { if (!(br.y + br.height <= ar.y + 2 && Math.abs(br.y + br.height - ar.y) <= pad && horizOverlap(ar, br))) return false; }
      else if (rel === 'below') { if (!(br.y >= ar.y + ar.height - 2 && Math.abs(br.y - (ar.y + ar.height)) <= pad && horizOverlap(ar, br))) return false; }
      else if (rel === 'leftOf') { if (!(br.x + br.width <= ar.x + 2 && Math.abs(br.x + br.width - ar.x) <= pad && vertOverlap(ar, br))) return false; }
      else if (rel === 'rightOf') { if (!(br.x >= ar.x + ar.width - 2 && Math.abs(br.x - (ar.x + ar.width)) <= pad && vertOverlap(ar, br))) return false; }
      else if (rel === 'near') { if (centerDist(ar, br) > pad) return false; }
    }
    if (spec.childrenOf) {
      var p = byId[spec.childrenOf];
      if (!p || el.parentElement !== p) return false;
    }
    if (spec.descendantsOf) {
      var d = byId[spec.descendantsOf];
      if (!d || d === el || !d.contains(el)) return false;
    }
    return true;
  }

  function horizOverlap(a, b) { return b.x < a.x + a.width && b.x + b.width > a.x; }
  function vertOverlap(a, b) { return b.y < a.y + a.height && b.y + b.height > a.y; }
  function centerDist(a, b) {
    var dx = (a.x + a.width / 2) - (b.x + b.width / 2);
    var dy = (a.y + a.height / 2) - (b.y + b.height / 2);
    return Math.sqrt(dx * dx + dy * dy);
  }

  function shape(ref, fields) {
    if (!fields || !fields.length) return ref;
    var out = { id: ref.id };
    for (var i = 0; i < fields.length; i++) out[fields[i]] = ref[fields[i]];
    return out;
  }

  // ---------------------------------------------------------------- overlays
  function ensureOverlay() {
    if (overlayHost && overlayHost.isConnected) return;
    overlayHost = document.createElement('div');
    overlayHost.setAttribute(OVERLAY_ATTR, '');
    overlayHost.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    overlayRoot = overlayHost.attachShadow ? overlayHost.attachShadow({ mode: 'open' }) : overlayHost;
    var style = document.createElement('style');
    style.textContent = [
      '.hl{position:fixed;border:2px solid #16d1a1;background:rgba(22,209,161,.14);border-radius:3px;pointer-events:none;transition:all .08s linear}',
      '.hl b{position:absolute;top:-20px;left:0;background:#16d1a1;color:#04201a;font:11px/1.4 ui-monospace,monospace;padding:1px 5px;border-radius:3px;white-space:nowrap}',
      '.cur{position:fixed;width:18px;height:18px;margin:-2px 0 0 -2px;pointer-events:none;transform:translateZ(0)}',
      '.cur svg{filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}',
      '.ring{position:fixed;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;border:2px solid #ff3d71;opacity:.9;pointer-events:none;animation:p .45s ease-out forwards}',
      '@keyframes p{to{width:44px;height:44px;margin:-22px 0 0 -22px;opacity:0}}'
    ].join('');
    overlayRoot.appendChild(style);
    (document.body || document.documentElement).appendChild(overlayHost);
  }

  function ensureCursor() {
    ensureOverlay();
    if (cursorEl && cursorEl.isConnected) return cursorEl;
    cursorEl = document.createElement('div');
    cursorEl.className = 'cur';
    cursorEl.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18"><path d="M2 1l12 6.5-5.2 1.3L6.5 15z" fill="#fff" stroke="#111" stroke-width="1.2"/></svg>';
    cursorEl.style.left = cursorPos.x + 'px';
    cursorEl.style.top = cursorPos.y + 'px';
    overlayRoot.appendChild(cursorEl);
    return cursorEl;
  }

  function setCursor(x, y) {
    cursorPos.x = x; cursorPos.y = y;
    var c = ensureCursor();
    c.style.left = x + 'px';
    c.style.top = y + 'px';
  }

  function hideCursor() {
    if (cursorEl && cursorEl.parentNode) cursorEl.parentNode.removeChild(cursorEl);
    cursorEl = null;
  }

  function pulse(x, y) {
    ensureOverlay();
    var r = document.createElement('div');
    r.className = 'ring';
    r.style.left = x + 'px';
    r.style.top = y + 'px';
    overlayRoot.appendChild(r);
    setTimeout(function () { if (r.parentNode) r.parentNode.removeChild(r); }, 500);
  }

  function highlight(ids, label, durationMs) {
    ensureOverlay();
    clearHighlights();
    for (var i = 0; i < ids.length; i++) {
      var el = byId[ids[i]];
      if (!el || !el.isConnected) continue;
      var r = el.getBoundingClientRect();
      var box = document.createElement('div');
      box.className = 'hl';
      box.style.left = r.left + 'px';
      box.style.top = r.top + 'px';
      box.style.width = r.width + 'px';
      box.style.height = r.height + 'px';
      var tag = document.createElement('b');
      tag.textContent = label || ids[i];
      box.appendChild(tag);
      overlayRoot.appendChild(box);
      highlights.push({ el: el, box: box });
    }
    if (durationMs && durationMs > 0) setTimeout(clearHighlights, durationMs);
    return highlights.length;
  }

  function repositionHighlights() {
    for (var i = 0; i < highlights.length; i++) {
      var h = highlights[i];
      if (!h.el.isConnected) continue;
      var r = h.el.getBoundingClientRect();
      h.box.style.left = r.left + 'px';
      h.box.style.top = r.top + 'px';
      h.box.style.width = r.width + 'px';
      h.box.style.height = r.height + 'px';
    }
  }

  function clearHighlights() {
    for (var i = 0; i < highlights.length; i++) {
      if (highlights[i].box.parentNode) highlights[i].box.parentNode.removeChild(highlights[i].box);
    }
    highlights = [];
  }

  // -------------------------------------------------------- change detection
  function emit(reason) {
    if (disposed) return;
    var next = scan();
    var added = [], removed = [], changed = [];
    for (var id in next) {
      var ref = refOf(next[id], id);
      var sig = ref.type + '|' + ref.name + '|' + ref.visible + '|' + ref.enabled + '|' +
                Math.round(ref.bounds.x) + ',' + Math.round(ref.bounds.y) + ',' +
                Math.round(ref.bounds.width) + ',' + Math.round(ref.bounds.height) + '|' + (ref.value || '');
      if (!(id in lastSet)) added.push(ref);
      else if (lastSet[id] !== sig) changed.push(ref);
      lastSet[id] = sig;
    }
    for (var old in lastSet) {
      if (!next[old]) { removed.push(old); delete lastSet[old]; }
    }
    if (!added.length && !removed.length && !changed.length && reason === 'mutation') return;
    var active = document.activeElement;
    var payload = {
      epoch: epoch,
      frameId: frameId,
      reason: reason,
      added: added,
      removed: removed,
      changed: changed,
      focused: active && active !== document.body ? refOf(active) : null,
      at: Date.now()
    };
    if (window.__dveEmit) { try { window.__dveEmit(payload); } catch (e) {} }
  }

  function schedule(reason) {
    if (disposed) return;
    if (pending) { pending.reason = reason === 'mutation' ? pending.reason : reason; return; }
    pending = { reason: reason };
    var run = function () {
      var r = pending.reason;
      pending = null;
      repositionHighlights();
      emit(r);
    };
    requestAnimationFrame(function () {
      if (window.requestIdleCallback) window.requestIdleCallback(run, { timeout: 120 });
      else setTimeout(run, 16);
    });
  }

  var mo = new MutationObserver(function () { schedule('mutation'); });
  var ro = new ResizeObserver(function () { epoch++; schedule('resize'); });

  function startObservers() {
    if (!document.documentElement) return;
    mo.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, characterData: false,
      attributeFilter: ['class', 'style', 'hidden', 'disabled', 'aria-hidden', 'aria-modal',
                        'aria-expanded', 'aria-checked', 'aria-disabled', 'open', 'value', 'role']
    });
    if (document.body) ro.observe(document.body);
    window.addEventListener('resize', function () { epoch++; schedule('resize'); }, { passive: true });
    window.addEventListener('scroll', function () { epoch++; schedule('scroll'); }, { passive: true, capture: true });
    document.addEventListener('focusin', function () { schedule('focus'); }, true);
  }

  // ---------------------------------------------------------------- commands
  var api = {
    init: function (fid) {
      frameId = fid;
      epoch++;
      return { frameId: frameId, epoch: epoch };
    },
    scan: function () {
      var next = scan();
      var n = 0;
      for (var k in next) n++;
      return { count: n, epoch: epoch, scans: scanCount };
    },
    summary: function () {
      var next = scan();
      var counts = {};
      var overlays = [];
      var focused = null;
      for (var id in next) {
        var el = next[id];
        var ref = refOf(el, id);
        counts[ref.type] = (counts[ref.type] || 0) + 1;
        if (ref.visible && (isModal(el) || ref.type === 'toast' || ref.type === 'alert' || ref.type === 'dialog')) {
          overlays.push(ref);
        }
        if (ref.focused) focused = ref;
      }
      var de = document.documentElement;
      return {
        url: location.href,
        title: document.title,
        epoch: epoch,
        viewport: { width: window.innerWidth, height: window.innerHeight, scrollX: window.scrollX, scrollY: window.scrollY },
        documentSize: { width: de.scrollWidth, height: de.scrollHeight },
        counts: counts,
        overlays: overlays,
        focused: focused
      };
    },
    query: function (spec) {
      var next = scan();
      var out = [];
      var limit = spec.limit || 200;
      for (var id in next) {
        var el = next[id];
        if (spec.css) { try { if (!el.matches(spec.css)) continue; } catch (e) { continue; } }
        var ref = refOf(el, id);
        if (!matches(el, ref, spec)) continue;
        out.push(shape(ref, spec.fields));
        if (out.length >= limit) break;
      }
      return out;
    },
    details: function (id) {
      var el = byId[id];
      if (!el || !el.isConnected) return null;
      var ref = refOf(el, id);
      var attrs = {};
      for (var i = 0; i < el.attributes.length; i++) {
        attrs[el.attributes[i].name] = el.attributes[i].value;
      }
      var kids = [];
      for (var j = 0; j < el.children.length; j++) {
        var c = el.children[j];
        if (isOverlayNode(c)) continue;
        kids.push(idFor(c));
      }
      var r = el.getBoundingClientRect();
      ref.tag = el.tagName.toLowerCase();
      ref.attributes = attrs;
      ref.parent = el.parentElement && !isOverlayNode(el.parentElement) ? idFor(el.parentElement) : null;
      ref.children = kids;
      ref.localBounds = { x: r.left, y: r.top, width: r.width, height: r.height };
      ref.scrollable = scrollable(el);
      ref.path = domPath(el);
      ref.state = {
        modal: isModal(el),
        toast: isToast(el),
        expanded: el.getAttribute('aria-expanded'),
        selected: el.getAttribute('aria-selected'),
        readOnly: !!el.readOnly,
        required: !!el.required,
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        tabIndex: el.tabIndex
      };
      return ref;
    },
    /** Validate a reference and return fresh geometry, or a stale marker. */
    resolve: function (id) {
      var el = byId[id];
      if (!el) return { stale: true, reason: 'unknown-id' };
      if (!el.isConnected) return { stale: true, reason: 'detached' };
      var ref = refOf(el, id);
      if (!ref.visible) return { stale: false, ref: ref, actionable: false, reason: 'not-visible' };
      return { stale: false, ref: ref, actionable: ref.enabled };
    },
    scrollIntoView: function (id, block) {
      var el = byId[id];
      if (!el || !el.isConnected) return false;
      el.scrollIntoView({ block: block || 'center', inline: 'center', behavior: 'instant' });
      epoch++;
      return true;
    },
    scrollBy: function (dx, dy) {
      window.scrollBy(dx || 0, dy || 0);
      epoch++;
      return { scrollX: window.scrollX, scrollY: window.scrollY };
    },
    focus: function (id) {
      var el = byId[id];
      if (!el || !el.isConnected) return false;
      el.focus({ preventScroll: false });
      return document.activeElement === el;
    },
    activeElement: function () {
      var a = document.activeElement;
      if (!a || a === document.body) return null;
      return refOf(a);
    },
    setValue: function (id, value) {
      var el = byId[id];
      if (!el || !el.isConnected) return false;
      var proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(proto, 'value');
      if (setter && setter.set) setter.set.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    selectOptions: function (id, values) {
      var el = byId[id];
      if (!el || !el.isConnected || el.tagName !== 'SELECT') return false;
      for (var i = 0; i < el.options.length; i++) {
        el.options[i].selected = values.indexOf(el.options[i].value) !== -1 ||
                                 values.indexOf(el.options[i].label) !== -1;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    frames: function () {
      var out = [];
      var iframes = document.querySelectorAll('iframe,frame');
      for (var i = 0; i < iframes.length; i++) {
        var f = iframes[i];
        var r = f.getBoundingClientRect();
        var accessible = false, boundary;
        try {
          accessible = !!(f.contentDocument && f.contentDocument.body);
          if (!accessible) boundary = 'no-document';
        } catch (e) {
          accessible = false;
          boundary = 'cross-origin: browser same-origin policy blocks document access';
        }
        out.push({
          elementId: idFor(f),
          src: f.getAttribute('src') || '',
          accessible: accessible,
          boundary: boundary,
          offset: { x: r.left + (window.scrollX || 0), y: r.top + (window.scrollY || 0) }
        });
      }
      return out;
    },
    cursor: function (x, y) { setCursor(x, y); return true; },
    cursorHide: function () { hideCursor(); return true; },
    pulse: function (x, y) { pulse(x, y); return true; },
    highlight: function (ids, label, durationMs) { return highlight(ids, label, durationMs); },
    clearHighlights: function () { clearHighlights(); return true; },
    flush: function (reason) { emit(reason || 'mutation'); return true; },
    stats: function () { return { scans: scanCount, epoch: epoch, tracked: Object.keys(byId).length }; },
    dispose: function () {
      disposed = true;
      try { mo.disconnect(); ro.disconnect(); } catch (e) {}
      clearHighlights();
      hideCursor();
      if (overlayHost && overlayHost.parentNode) overlayHost.parentNode.removeChild(overlayHost);
      overlayHost = null;
      return true;
    }
  };

  Object.defineProperty(window, '__dve', { value: api, enumerable: false, configurable: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObservers, { once: true });
  } else {
    startObservers();
  }
})();
`;
