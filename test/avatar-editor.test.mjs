// VM state-machine tests, not browser or pixel-level acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const code = await readFile(new URL('../avatar-editor.js', import.meta.url), 'utf8');

function harness() {
  let document;
  class Element {
    constructor(id) {
      this.id = id; this.listeners = {}; this.attrs = {}; this.children = [];
      this.disabled = false; this.open = false; this.isConnected = true;
      const classes = new Set();
      this.classList = { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x), toggle: (x, on) => on ? classes.add(x) : classes.delete(x) };
      this.style = { setProperty(k,v,p='') { this[k]=v; this[k+'Priority']=p; }, getPropertyValue(k) { return this[k] || ''; }, getPropertyPriority(k) { return this[k+'Priority'] || ''; }, removeProperty(k) { delete this[k]; delete this[k+'Priority']; } };
    }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    fire(type, props = {}) { const e = { target: this, preventDefault() { this.defaultPrevented = true; }, ...props }; for (const fn of this.listeners[type] || []) fn(e); return e; }
    click() { if (!this.disabled) this.fire('click'); }
    focus() { document.activeElement = this; }
    setAttribute(k,v) { this.attrs[k]=v; }
    removeAttribute(k) { delete this.attrs[k]; if (k === 'src') this.src=''; }
    replaceChildren(...items) { this.children=items; }
    remove() { this.removed=true; }
    showModal() { this.open=true; }
    close() { this.open=false; setImmediate(() => this.fire('close')); }
    getBoundingClientRect() { return {left:0,top:0,right:500,bottom:500}; }
  }
  const keys = ['title','close','stage','source','empty','choose','reselect','name','note','cancel','save','file'];
  const el = Object.fromEntries(keys.map(k => [k, new Element('avatar-editor-'+k)]));
  const actions = ['in','out','left','right','reset'].map(a => { const e=new Element(a); e.dataset={avatarAction:a}; return e; });
  const previews = [new Element('preview'), new Element('preview')];
  const dialog = new Element('dialog');
  dialog.querySelectorAll = selector => selector === '[id]' ? Object.values(el) : selector === '[data-avatar-action]' ? actions : selector === '.isa-avatar-editor-preview' ? previews : [];
  const opener = new Element('opener'), body = new Element('body');
  body.append = () => {};
  const probes=[], crops=[], blobs=[], revoked=[], created=[];
  const ctx = new Proxy({}, {get: () => () => {}, set: () => true});
  document = {body, activeElement:opener, getElementById: () => null, createElement: tag => tag === 'dialog' ? dialog : {getContext: () => ctx, toDataURL: () => 'data:image/png;base64,c2FtcGxl'} };
  class FileMock { constructor(parts, name, options) { this.parts=parts; this.name=name; this.type=options.type; this.size=parts.reduce((n,p)=>n+(p.size || 0),0); } }
  class ImageMock extends Element { constructor() { super('probe'); this.naturalWidth=1000; this.naturalHeight=750; probes.push(this); } }
  class Cropper {
    constructor(source, options) { this.source=source; this.options=options; this.ready=false; this.image=new Element('clone'); this.sizingImage=new Element('sizing'); this.moves=[]; crops.push(this); }
    triggerReady() { this.ready=true; this.options.ready(); }
    destroy() { this.destroyed=true; }
    disable() { this.disabled=true; } enable() { this.disabled=false; }
    move(...args) { this.moves.push(args); } zoom() {} rotate() {} reset() {}
    getCroppedCanvas(options) { this.exportOptions=options; return {toBlob: (cb,type,quality) => blobs.push({cb,type,quality})}; }
  }
  const media={matches:false, addEventListener() {}};
  const window={File:FileMock, Image:ImageMock, Cropper, matchMedia:()=>media, scrollX:12, scrollY:34, scrollTo(value){this.scrolled=value;}, requestAnimationFrame(fn){fn();}, setTimeout, URL:{createObjectURL(){const url='blob:test/'+(created.length+1); created.push(url); return url;}, revokeObjectURL(url){revoked.push(url);}}};
  vm.runInNewContext(code, {window,document,setTimeout,clearTimeout,console});
  const open = options => window.ISAAvatarEditor.open({onSave:()=>{}, ...options});
  const input = () => new FileMock([{size:100}], 'photo.png', {type:'image/png'});
  const load = () => { const p=probes.at(-1); p.onload(); return crops.at(-1); };
  const ready = () => { const c=load(); c.triggerReady(); return c; };
  return {el,actions,previews,dialog,document,window,opener,probes,crops,blobs,revoked,created,open,input,load,ready};
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('open validates callback, synchronously opens and cancel restores focus and scroll', async () => {
  const h=harness(); await assert.rejects(h.window.ISAAvatarEditor.open(), /onSave/);
  const p=h.open({name:'测试'}); assert.equal(h.dialog.open,true); assert.equal(h.el.name.textContent,'测试');
  assert.equal(h.document.activeElement,h.el.choose); assert.equal(h.document.body.classList.contains('isa-avatar-editor-scroll-lock'),true);
  h.el.cancel.click(); assert.equal(await p,null); assert.equal(h.dialog.open,false); assert.equal(h.document.activeElement,h.opener); assert.equal(h.window.scrolled.top,34);
});

test('before-ready arrows do nothing, ready enables editing', async () => {
  const h=harness(), p=h.open({file:h.input()}), c=h.load();
  const event=h.el.stage.fire('keydown',{key:'ArrowLeft'}); assert.equal(event.defaultPrevented,undefined); assert.equal(c.moves.length,0); assert.equal(h.el.save.disabled,true);
  c.triggerReady(); assert.equal(h.el.save.disabled,false); assert.equal(h.el.stage.fire('keydown',{key:'ArrowRight'}).defaultPrevented,true); assert.deepEqual(c.moves[0],[5,0]);
  h.el.close.click(); assert.equal(await p,null);
});

test('save is single flight, blocks close and duplicate open until host succeeds', async () => {
  const h=harness(); let resolveSave, received, calls=0;
  const p=h.open({file:h.input(),onSave:file => { calls++; received=file; return new Promise(resolve => {resolveSave=resolve;}); }});
  assert.equal(h.open(),p); const c=h.ready(); h.el.save.click(); h.el.save.fire('click');
  assert.equal(h.blobs.length,1); assert.equal(c.disabled,true); assert.equal(h.el.cancel.disabled,true); assert.equal(h.dialog.attrs['aria-busy'],'true');
  assert.equal(h.dialog.fire('cancel').defaultPrevented,true); assert.equal(h.dialog.open,true);
  await assert.rejects(h.open(),/正在保存/); assert.equal(h.blobs[0].type,'image/webp'); assert.equal(h.blobs[0].quality,0.9);
  assert.equal(c.exportOptions.width,256); assert.equal(c.exportOptions.height,256);
  h.blobs[0].cb({type:'image/webp',size:42}); await tick(); assert.equal(calls,1); assert.equal(received.name,'isa-avatar-256.webp'); assert.equal(received.type,'image/webp'); assert.equal(h.dialog.open,true);
  resolveSave(); assert.equal(await p,received); assert.equal(h.dialog.open,false); assert.equal(c.destroyed,true); assert.deepEqual(h.revoked,['blob:test/1']);
});

test('encoding and host failures preserve crop and allow retry', async () => {
  const h=harness(); let calls=0; const p=h.open({file:h.input(), onSave:()=>{calls++; throw Error('host failed');}}); const c=h.ready();
  h.el.save.click(); h.blobs[0].cb(null); await tick(); assert.match(h.el.note.textContent,/保存失败/); assert.equal(h.el.save.disabled,false); assert.equal(c.disabled,false); assert.equal(calls,0);
  h.el.save.click(); h.blobs[1].cb({type:'image/webp',size:1}); await tick(); assert.equal(calls,1); assert.match(h.el.note.textContent,/保存失败/); assert.equal(h.dialog.open,true); assert.equal(c.destroyed,undefined); assert.equal(h.el.save.disabled,false);
  h.el.cancel.click(); assert.equal(await p,null);
});

test('replacement and cancellation revoke source URLs and clean probes and Cropper clones', async () => {
  const h=harness(), p=h.open({file:h.input()}); const old=h.probes[0], late=old.onload;
  h.el.file.files=[h.input()]; h.el.file.fire('change'); assert.equal(old.onload,null); assert.equal(old.src,''); assert.deepEqual(h.revoked,['blob:test/1']);
  late(); assert.equal(h.crops.length,0); const c=h.load(); c.image.onload=()=>{}; c.sizingImage.onerror=()=>{};
  h.previews[0].children=[1]; h.previews[0].style.width='100px'; h.el.cancel.click(); assert.equal(await p,null);
  assert.deepEqual(h.revoked,['blob:test/1','blob:test/2']); assert.equal(c.destroyed,true); assert.equal(c.image.removed,true); assert.equal(c.image.onload,null); assert.equal(c.sizingImage.removed,true); assert.equal(c.sizingImage.onerror,null); assert.equal(h.el.source.src,''); assert.equal(h.previews[0].children.length,0); assert.equal(h.previews[0].style.width,undefined);
});

test('cancelling the file picker keeps the current crop open; Escape closes the editor', async () => {
  const h = harness();
  const p = h.open({file:h.input()});
  const c = h.ready();
  const result = h.dialog.fire('cancel', {target:h.el.file});
  assert.equal(result.defaultPrevented, undefined);
  assert.equal(h.dialog.open, true);
  assert.equal(c.destroyed, undefined);
  assert.equal(h.el.save.disabled, false);
  assert.deepEqual(h.revoked, []);
  const escape = h.dialog.fire('cancel');
  assert.equal(escape.defaultPrevented, true);
  assert.equal(await p, null);
  assert.equal(h.dialog.open, false);
});

test('browser PNG fallback retains its actual type and can be saved', async () => {
  const h=harness(); let received; const p=h.open({file:h.input(),onSave:file=>{received=file;}}); h.ready();
  h.el.save.click(); h.blobs[0].cb({type:'image/png',size:42});
  assert.equal(await p,received); assert.equal(received.type,'image/png'); assert.equal(received.name,'isa-avatar-256.png');
});

test('cancel completes and releases the image even when Cropper cleanup fails', async () => {
  const h=harness(), p=h.open({file:h.input()}), c=h.ready();
  c.destroy=()=>{throw Error('cleanup failed');};
  h.el.cancel.click();
  assert.equal(await p,null);
  assert.equal(h.dialog.open,false);
  assert.deepEqual(h.revoked,['blob:test/1']);
  assert.equal(h.document.body.classList.contains('isa-avatar-editor-scroll-lock'),false);
});
