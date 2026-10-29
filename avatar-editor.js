/* ISA Spectrum avatar editor · Requires Cropper.js 1.6.2 and its stylesheet. */
(function (window, document) {
  'use strict';
  if (window.ISAAvatarEditor) return;
  const prefix = 'avatar-editor-';
  let dialog, nodes, cropper = null, sourceUrl = null, probe = null;
  let revision = 0, busy = false, timer = null, session = null, mountedMobile = false;
  let scrollState = null;
  const media = window.matchMedia('(max-width:760px)');
  const get = key => nodes[key];
  const note = (text, error = false) => {
    get('note').textContent = text;
    get('note').classList.toggle('isa-avatar-editor-error', error);
  };
  function controls() {
    const ready = Boolean(cropper && cropper.ready);
    dialog.querySelectorAll('[data-avatar-action]').forEach(button => { button.disabled = !ready || busy; });
    get('save').disabled = !ready || busy;
    ['cancel', 'close', 'choose', 'reselect', 'file'].forEach(key => { get(key).disabled = busy; });
    get('save').textContent = busy ? '正在保存…' : '保存头像';
    dialog.setAttribute('aria-busy', String(busy));
  }
  function stopProbe() {
    if (!probe) return;
    probe.onload = probe.onerror = null;
    probe.removeAttribute('src');
    probe = null;
  }
  function releaseCropper() {
    clearTimeout(timer); timer = null;
    const previous = cropper;
    cropper = null;
    // 1.6.2 clone() stores its clone in .image; destroy during sizing can leave it behind.
    const images = [previous && previous.image, previous && previous.sizingImage];
    try { if (previous) previous.destroy(); }
    catch (error) { console.warn('头像裁切组件清理失败', error); }
    finally {
      for (const image of images) {
        if (!image || image === get('source')) continue;
        image.onload = image.onerror = null;
        image.removeAttribute('src'); image.remove();
      }
      dialog.querySelectorAll('.isa-avatar-editor-preview').forEach(preview => {
        preview.replaceChildren();
        preview.style.removeProperty('width'); preview.style.removeProperty('height');
      });
    }
  }
  function clearEditor() {
    revision++; stopProbe(); releaseCropper();
    if (sourceUrl) window.URL.revokeObjectURL(sourceUrl);
    sourceUrl = null;
    get('source').removeAttribute('src'); get('source').style.display = 'none';
    get('empty').hidden = false; get('file').value = ''; controls();
  }
  function lockScroll() {
    const body = document.body;
    scrollState = { x: window.scrollX, y: window.scrollY,
      top: body.style.getPropertyValue('--isa-avatar-editor-scroll-top'),
      priority: body.style.getPropertyPriority('--isa-avatar-editor-scroll-top'),
      hadClass: body.classList.contains('isa-avatar-editor-scroll-lock') };
    body.style.setProperty('--isa-avatar-editor-scroll-top', -scrollState.y + 'px');
    body.classList.add('isa-avatar-editor-scroll-lock');
  }
  function unlockScroll() {
    if (!scrollState) return;
    const state = scrollState; scrollState = null;
    if (!state.hadClass) document.body.classList.remove('isa-avatar-editor-scroll-lock');
    if (state.top) document.body.style.setProperty('--isa-avatar-editor-scroll-top', state.top, state.priority);
    else document.body.style.removeProperty('--isa-avatar-editor-scroll-top');
    // Override a site's smooth-scroll setting when restoring the locked page.
    window.scrollTo({ left: state.x, top: state.y, behavior: 'instant' });
  }
  function finish(result = null) {
    const ended = session;
    session = null; busy = false;
    try { clearEditor(); }
    finally {
      try {
        unlockScroll();
        if (ended?.focus?.isConnected) ended.focus.focus({ preventScroll: true });
      } finally {
        if (ended) ended.resolve(result);
      }
    }
  }
  function close(result = null) {
    if (busy || !dialog.open) return;
    dialog.close(); finish(result);
  }
  function failLoad(message) {
    clearEditor(); note(message, true);
  }
  function mountCropper(generation, label, data = {}) {
    mountedMobile = media.matches;
    try {
      if (typeof window.Cropper !== 'function') throw new Error('Cropper unavailable');
      timer = window.setTimeout(() => {
        if (generation === revision && dialog.open && !cropper?.ready)
          failLoad('图片加载超时，请重新选择照片。');
      }, 20000);
      cropper = new window.Cropper(get('source'), {
        aspectRatio: 1, viewMode: 1, dragMode: 'move', autoCropArea: 0.8,
        preview: dialog.querySelectorAll('.isa-avatar-editor-preview'),
        background: false, responsive: true, data,
        toggleDragModeOnDblclick: false, checkOrientation: true,
        ready() {
          if (generation !== revision || !dialog.open) return;
          clearTimeout(timer); timer = null; controls();
          note(label + '已载入。拖动、缩放或旋转后保存。');
          // A media change may have happened while decoding the source image.
          window.requestAnimationFrame(rebuildAtBreakpoint);
        }
      });
    } catch (error) {
      failLoad('头像编辑器加载失败，请重新选择照片。');
    }
  }
  function rebuildAtBreakpoint() {
    if (!dialog?.open || !cropper?.ready || busy || media.matches === mountedMobile) return;
    try {
      const data = cropper.getData();
      revision++; releaseCropper(); controls();
      mountCropper(revision, '照片', data);
    } catch (error) { failLoad('调整布局失败，请重新选择照片。'); }
  }
  function loadImage(url, label) {
    clearEditor(); sourceUrl = url;
    const generation = revision;
    note('正在读取图片…');
    const image = new window.Image(); probe = image;
    timer = window.setTimeout(() => {
      if (generation === revision && dialog.open) failLoad('读取图片超时，请换一张图片。');
    }, 20000);
    image.onload = () => {
      if (generation !== revision || !dialog.open) return;
      clearTimeout(timer); timer = null;
      const pixels = image.naturalWidth * image.naturalHeight;
      stopProbe();
      if (!pixels || pixels > 24000000) {
        failLoad('图片无效或超过 2400 万像素，请缩小后重试。'); return;
      }
      get('empty').hidden = true;
      get('source').style.display = 'block'; get('source').src = url;
      mountCropper(generation, label);
    };
    image.onerror = () => {
      if (generation === revision && dialog.open) failLoad('无法读取图片，请换一张 JPEG、PNG 或 WebP。');
    };
    image.src = url;
  }
  function chooseFile(file) {
    if (busy || !file) return;
    if (!(file instanceof window.File) || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      note('请选择 JPEG、PNG 或 WebP 图片。', true); return;
    }
    if (!file.size || file.size > 10 * 1024 * 1024) {
      note('请选择非空且不超过 10 MB 的图片。', true); return;
    }
    try { loadImage(window.URL.createObjectURL(file), '照片'); }
    catch (error) { failLoad('读取图片失败，请重新选择照片。'); }
  }
  async function save() {
    if (!cropper?.ready || busy || !session) return;
    const activeSession = session, generation = revision;
    busy = true; controls();
    try {
      cropper.disable(); note('正在生成并保存头像…');
      const canvas = cropper.getCroppedCanvas({ width: 256, height: 256, fillColor: '#fff',
        imageSmoothingEnabled: true, imageSmoothingQuality: 'high' });
      if (!canvas) throw new Error('无法生成裁切图片');
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(value => value ? resolve(value) : reject(new Error('图片编码失败')), 'image/webp', 0.9);
      });
      if (generation !== revision || session !== activeSession || !dialog.open) return;
      if (!['image/webp', 'image/png'].includes(blob.type)) throw new Error('浏览器无法生成支持的图片格式');
      const extension = blob.type === 'image/webp' ? 'webp' : 'png';
      const file = new window.File([blob], 'isa-avatar-256.' + extension, { type: blob.type, lastModified: Date.now() });
      // The host owns persistence. Never close until its asynchronous callback succeeds.
      await activeSession.onSave(file);
      if (generation !== revision || session !== activeSession || !dialog.open) return;
      busy = false; close(file);
    } catch (error) {
      if (generation !== revision || session !== activeSession || !dialog.open) return;
      note('保存失败：' + (error instanceof Error && error.message ? error.message : '请稍后重试') + '。编辑已保留，可再次保存。', true);
    } finally {
      if (session === activeSession && dialog.open) {
        busy = false; cropper?.enable(); controls();
        // Do not lose breakpoint changes made while onSave was pending.
        if (media.matches !== mountedMobile) {
          const message = get('note').textContent;
          const isError = get('note').classList.contains('isa-avatar-editor-error');
          rebuildAtBreakpoint();
          if (isError) note(message, true);
        }
      }
    }
  }
  function init() {
    if (dialog) return;
    if (!document.body) throw new Error('请在文档 body 就绪后打开头像编辑器');
    if (document.getElementById(prefix + 'dialog')) throw new Error('头像编辑器 ID 冲突');
    const element = document.createElement('dialog');
    element.id = prefix + 'dialog'; element.className = 'isa-avatar-editor';
    element.setAttribute('aria-labelledby', prefix + 'title');
    element.setAttribute('aria-describedby', prefix + 'note');
    element.innerHTML =       '<header class="isa-avatar-editor-head"><div><h2 id="avatar-editor-title">更改头像</h2><p>选一个喜欢的角度，让大家认识你。</p></div><button type="button" id="avatar-editor-close" class="isa-avatar-editor-close" aria-label="关闭头像编辑">×</button></header>' +
      '<div class="isa-avatar-editor-body"><section class="isa-avatar-editor-editing" aria-label="裁切编辑"><div id="avatar-editor-stage" tabindex="0" aria-label="图片裁切区域，可用方向键微调"><img id="avatar-editor-source" alt="正在编辑的头像"><div id="avatar-editor-empty"><strong>选择一张照片</strong><p>JPEG、PNG、WebP · 不超过 10 MB</p><button type="button" id="avatar-editor-choose" class="isa-avatar-editor-primary">选择照片</button></div></div>' +
      '<div class="isa-avatar-editor-toolbar" aria-label="图片调整"><button type="button" data-avatar-action="out" aria-label="缩小" disabled>−</button><button type="button" data-avatar-action="in" aria-label="放大" disabled>＋</button><button type="button" data-avatar-action="left" disabled>↶ 左转</button><button type="button" data-avatar-action="right" disabled>↷ 右转</button><button type="button" data-avatar-action="reset" disabled>重置</button></div><p class="isa-avatar-editor-hint">拖动图片或裁切框 · 滚轮 / 双指缩放</p><button type="button" id="avatar-editor-reselect" class="isa-avatar-editor-text">重新选择照片</button></section>' +
      '<aside class="isa-avatar-editor-previews" aria-label="头像显示预览"><h3>看看显示效果</h3><div class="isa-avatar-editor-big-wrap"><div class="isa-avatar-editor-preview isa-avatar-editor-large"></div><small>个人头像</small></div><div class="isa-avatar-editor-small-wrap"><div class="isa-avatar-editor-preview isa-avatar-editor-small"></div><strong id="avatar-editor-name"></strong></div></aside></div>' +
      '<footer class="isa-avatar-editor-foot"><p id="avatar-editor-note" role="status" aria-live="polite" aria-atomic="true"></p><div><button type="button" id="avatar-editor-cancel" class="isa-avatar-editor-secondary">取消</button><button type="button" id="avatar-editor-save" class="isa-avatar-editor-primary" disabled>保存头像</button></div></footer><input type="file" id="avatar-editor-file" accept="image/jpeg,image/png,image/webp" hidden>';
    if (typeof element.showModal !== 'function') throw new Error('此浏览器不支持原生 dialog，请更新浏览器');
    document.body.append(element); dialog = element;
    nodes = {};
    dialog.querySelectorAll('[id]').forEach(node => { nodes[node.id.slice(prefix.length)] = node; });
    ['close', 'cancel'].forEach(key => get(key).addEventListener('click', () => close()));
    ['choose', 'reselect'].forEach(key => get(key).addEventListener('click', () => { if (!busy) get('file').click(); }));
    get('save').addEventListener('click', save);
    get('file').addEventListener('change', () => {
      const file = get('file').files[0]; get('file').value = ''; chooseFile(file);
    });
    dialog.addEventListener('cancel', event => {
      // The file input's cancel event bubbles; it must not close the editor.
      if (event.target !== dialog) return;
      event.preventDefault(); close();
    });
    dialog.addEventListener('close', () => { if (!dialog.open && session) finish(); });
    dialog.addEventListener('click', event => {
      const rect = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) close();
    });
    dialog.querySelectorAll('[data-avatar-action]').forEach(button => button.addEventListener('click', () => {
      if (!cropper?.ready || busy) return;
      const action = button.dataset.avatarAction;
      if (action === 'in') cropper.zoom(0.1);
      if (action === 'out') cropper.zoom(-0.1);
      if (action === 'left') cropper.rotate(-90);
      if (action === 'right') cropper.rotate(90);
      if (action === 'reset') cropper.reset();
    }));
    get('stage').addEventListener('keydown', event => {
      if (!cropper?.ready || busy) return;
      const moves = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, -5], ArrowDown: [0, 5] };
      if (moves[event.key]) { event.preventDefault(); cropper.move(...moves[event.key]); }
    });
    if (media.addEventListener) media.addEventListener('change', rebuildAtBreakpoint);
    else media.addListener(rebuildAtBreakpoint);
  }
  function rejected(error) {
    const promise = Promise.reject(error);
    // Safe even when a click handler ignores the return value; callers can still catch it.
    promise.catch(() => {}); return promise;
  }
  function open(options = {}) {
    // Intentionally NOT async: showModal runs in the original user activation stack.
    if (session) {
      if (busy) return rejected(new Error('头像正在保存，请等待完成'));
      get('choose').focus(); return session.promise;
    }
    if (!options || typeof options.onSave !== 'function') return rejected(new TypeError('onSave 必须是保存回调函数'));
    try {
      init(); clearEditor();
      get('name').textContent = String(options.name || '你');
      note('选择照片并调整裁切，满意后保存头像。');
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      session = { promise, resolve, onSave: options.onSave, focus: document.activeElement };
      lockScroll(); dialog.showModal(); get('choose').focus();
      if (options.file) chooseFile(options.file);
      return promise;
    } catch (error) {
      if (dialog?.open) dialog.close();
      if (session) finish(); else unlockScroll();
      return rejected(error);
    }
  }
  window.ISAAvatarEditor = Object.freeze({ open });
})(window, document);
