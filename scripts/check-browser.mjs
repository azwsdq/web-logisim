// Run against a separate test Chrome profile with --remote-debugging-port=9222.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const base = process.env.CDP_URL || 'http://127.0.0.1:9222';
const target = await (await fetch(base + '/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl), requests = new Map(), errors = [];
let seq = 0;
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
ws.onmessage = event => {
  const m = JSON.parse(event.data);
  if (m.id) {
    const request = requests.get(m.id);
    requests.delete(m.id);
    m.error ? request.reject(Error(m.error.message)) : request.resolve(m.result);
  }
  else if (m.method === 'Runtime.exceptionThrown') {
    errors.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || ''));
  }
};
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    requests.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  }
  return r.result.value;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ready() {
  for (let i = 0; i < 100; i++) {
    if (await evaluate('Boolean(document.querySelector(".node"))')) {
      // The startup fit runs in an animation frame: wait for it, or a measured
      // point would not match the layout the click lands on.
      await evaluate('new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))');
      return;
    }
    await sleep(50);
  }
  throw Error('Editor did not load');
}
async function click(selector) {
  const p = await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing element '+${JSON.stringify(selector)});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await mouse('mousePressed', p);
  await mouse('mouseReleased', p);
}
async function mouse(type, p) {
  await cdp('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
}
const value = id => evaluate(`document.querySelector('.node[data-id="${id}"] .value')?.textContent`);
const saved = () => evaluate('JSON.parse(localStorage.getItem("web-logisim-v1"))');
async function action(id) {
  await evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
}
async function drag(selector, dx, dy) {
  const p = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await mouse('mousePressed', p);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x + dx, y: p.y + dy, button: 'left', buttons: 1 });
  await mouse('mouseReleased', { x: p.x + dx, y: p.y + dy });
}
try {
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: process.env.APP_URL || 'http://localhost:5173' });
  await ready();
  await evaluate('localStorage.removeItem("web-logisim-v1")');
  await cdp('Page.reload');
  await ready();
  await action('poke-tool');
  assert.equal(await value('out-q'), '0');
  await click('.node[data-id="r"] .body');
  assert.equal(await value('out-q'), '0');
  await click('.node[data-id="s"] .body');
  assert.equal(await value('out-q'), '1');
  await click('.node[data-id="s"] .body');
  assert.equal(await value('out-q'), '1');
  await cdp('Page.reload');
  await ready();
  assert.equal(await value('out-q'), '1');
  console.log('PASS: NOR latch set/hold and page reload preserve Q=1');
  await action('select-tool');
  const before = (await saved()).nodes.find(n => n.id === 'q');
  await evaluate(`window.untouchedNode = document.querySelector('.node[data-id="s"]'); window.untouchedWire = document.querySelector('[data-wire="s-nq"]');`);
  await drag('.node[data-id="q"] .body', 40, 30);
  assert.equal(await evaluate(`window.untouchedNode === document.querySelector('.node[data-id="s"]') && window.untouchedWire === document.querySelector('[data-wire="s-nq"]')`), true);
  const after = (await saved()).nodes.find(n => n.id === 'q');
  assert.notEqual(after.x, before.x);
  assert.equal(await value('out-q'), '1');
  assert.equal(await evaluate('window.getSelection().toString()'), '');
  await action('undo');
  assert.equal((await saved()).nodes.find(n => n.id === 'q').x, before.x);
  assert.equal(await value('out-q'), '1');
  await action('redo');
  assert.equal((await saved()).nodes.find(n => n.id === 'q').x, after.x);
  assert.equal(await value('out-q'), '1');
  console.log('PASS: move, undo/redo preserve state; unaffected SVG nodes retained; no text selection');
  await action('pause');
  await action('poke-tool');
  await click('.node[data-id="r"] .body');
  assert.equal(await value('out-q'), '1');
  await action('pause');
  assert.equal(await value('out-q'), '0');
  await click('.node[data-id="r"] .body');
  assert.equal(await value('out-q'), '0');
  console.log('PASS: pause/resume and reset/hold');
  await action('new');
  for (const [type, x, y] of [['INPUT', 350, 220], ['NOT', 650, 220], ['OUTPUT', 930, 220], ['OUTPUT', 930, 420]]) {
    await click(`[data-add="${type}"]`);
    await mouse('mousePressed', { x, y });
    await mouse('mouseReleased', { x, y });
  }
  let data = await saved();
  assert.equal(data.nodes.length, 4);
  const [input, not, out, branch] = data.nodes;
  const pinSelector = (id, direction) => `.node[data-id="${id}"] [data-direction="${direction}"] .pin`;
  await click(pinSelector(input.id, 'out'));
  await click(pinSelector(not.id, 'in'));
  const a = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(pinSelector(not.id, 'out'))}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  const b = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(pinSelector(out.id, 'in'))}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await mouse('mousePressed', a);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...b, button: 'left', buttons: 1 });
  await mouse('mouseReleased', b);
  assert.equal((await saved()).wires.length, 2);
  assert.equal(await value(out.id), '1');
  await action('poke-tool');
  await click(`.node[data-id="${input.id}"] .body`);
  assert.equal(await value(out.id), '0');
  console.log('PASS: placement, click-to-connect, drag-to-connect, propagation');
  await action('wire-tool');
  const wireId = (await saved()).wires[1].id;
  // Midpoint of a known horizontal path, with no component under it.
  const wp = await evaluate(`(()=>{const path=document.querySelector('[data-wire="${wireId}"]');const p=path.getPointAtLength(path.getTotalLength()/2);const q=new DOMPoint(p.x,p.y).matrixTransform(path.getScreenCTM());return {x:q.x,y:q.y}})()`);
  await mouse('mousePressed', wp);
  await mouse('mouseReleased', wp);
  await click(pinSelector(branch.id, 'in'));
  assert.equal((await saved()).wires.length, 3);
  assert.equal(await value(branch.id), '0');
  await action('poke-tool');
  await click(`.node[data-id="${input.id}"] .body`);
  assert.equal(await value(out.id), '1');
  assert.equal(await value(branch.id), '1');
  console.log('PASS: wire fan-out propagates to both outputs');
  await action('select-tool');
  await mouse('mousePressed', wp);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: wp.x, y: wp.y + 50, button: 'left', buttons: 1 });
  await mouse('mouseReleased', { x: wp.x, y: wp.y + 50 });
  assert.ok((await saved()).wires.some(w => w.points?.length));
  assert.equal(await value(out.id), '1');
  await action('undo');
  await action('redo');
  assert.equal(await value(out.id), '1');
  console.log('PASS: wire route editing and undo/redo preserve logic');
  await action('rs-example');
  await click('.node[data-id="r"] .body');
  await click('.node[data-id="s"] .body');
  await click('.node[data-id="s"] .body');
  assert.equal(await value('out-q'), '1', 'latch holds Q=1 before any selection');
  await action('select-tool');
  const boundsOf = id => evaluate(`(()=>{const r=document.querySelector('.node[data-id="${id}"]').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
  const frameOf = async ids => {
    const boxes = await Promise.all(ids.map(boundsOf));
    return {
      from: { x: Math.min(...boxes.map(b => b.x)) - 15, y: Math.min(...boxes.map(b => b.y)) - 15 },
      to: { x: Math.max(...boxes.map(b => b.x + b.w)) + 15, y: Math.max(...boxes.map(b => b.y + b.h)) + 15 },
    };
  };
  const count = selector => evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
  const key = (k, code, modifiers = 0) => cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, modifiers, windowsVirtualKeyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0 })
    .then(() => cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers, windowsVirtualKeyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0 }));
  const frame = await frameOf(['q', 'nq']);
  const marqueeShown = () => evaluate(`(()=>{const r=document.getElementById('marquee');return r.style.display==='block'&&Number(r.getAttribute('width'))>0})()`);
  const frameDrag = async ({ verify }) => {
    await mouse('mousePressed', frame.from);
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...frame.to, button: 'left', buttons: 1 });
    await sleep(50);
    await verify();
    await mouse('mouseReleased', frame.to);
  };
  await frameDrag({
    verify: async () => {
      assert.equal(await marqueeShown(), true, 'frame rectangle follows the pointer');
      assert.equal(await count('.node .selection'), 2, 'frame highlights both gates while dragging');
    },
  });
  assert.equal(await marqueeShown(), false, 'frame rectangle hides on release');
  assert.equal(await count('.node .selection'), 2, 'frame selects both gates');
  assert.ok(await count('.wire.selected') > 0, 'wires crossing the frame come along');
  assert.equal(await evaluate('window.getSelection().toString()'), '');
  const emptySpot = await evaluate(`(()=>{const r=document.getElementById('canvas').getBoundingClientRect();return {x:r.x+r.width-40,y:r.y+r.height-40}})()`);
  assert.equal(await evaluate(`Boolean(document.elementFromPoint(${emptySpot.x}, ${emptySpot.y}).closest('.node,[data-wire]'))`), false, 'a clear spot on the canvas');
  await mouse('mousePressed', emptySpot);
  await mouse('mouseReleased', emptySpot);
  assert.equal(await count('.node .selection'), 0, 'a click on empty canvas clears the selection');
  await frameDrag({ verify: async () => { } });
  assert.equal(await count('.node .selection'), 2, 'the group is selected again');
  const gates = (await saved()).nodes.filter(n => n.id === 'q' || n.id === 'nq');
  await drag('.node[data-id="q"] .body', 40, 0);
  const moved = (await saved()).nodes.filter(n => n.id === 'q' || n.id === 'nq');
  const shifts = moved.map(n => n.x - gates.find(g => g.id === n.id).x);
  assert.ok(shifts[0] > 0 && shifts[0] % 10 === 0, 'a gate moved onto the grid');
  assert.deepEqual(shifts[1], shifts[0], 'both gates move by the same snapped offset');
  assert.equal(await value('out-q'), '1', 'moving a group keeps latch state');
  await action('undo');
  const undone = (await saved()).nodes.filter(n => n.id === 'q' || n.id === 'nq');
  assert.deepEqual(undone.map(n => n.x), gates.map(n => n.x), 'one undo reverts the whole group');
  assert.equal(await value('out-q'), '1');
  await key('a', 'KeyA', 2);
  assert.equal(await count('.node .selection'), 6, 'Ctrl+A selects every component');
  assert.equal(await value('out-q'), '1', 'selecting all keeps latch state');
  await key('Escape', 'Escape');
  assert.equal(await count('.node .selection'), 0, 'Escape clears the selection');
  await mouse('mousePressed', frame.from);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...frame.to, button: 'left', buttons: 1 });
  await sleep(50);
  assert.equal(await marqueeShown(), true);
  await key('Escape', 'Escape');
  assert.equal(await marqueeShown(), false, 'Escape ends the frame gesture');
  await mouse('mouseReleased', frame.to);
  assert.equal(await count('.node .selection'), 0, 'the released pointer starts nothing');
  await frameDrag({ verify: async () => { } });
  await key('Delete', 'Delete');
  const afterDelete = await saved();
  assert.deepEqual(afterDelete.nodes.map(n => n.id).filter(id => id === 'q' || id === 'nq'), []);
  assert.equal(afterDelete.wires.some(w => w.from.node === 'q' || w.to.node === 'q' || w.from.node === 'nq' || w.to.node === 'nq'), false);
  await action('undo');
  assert.equal((await saved()).nodes.filter(n => n.id === 'q').length, 1, 'one undo restores both gates');
  console.log('PASS: frame selection, group move, select all and group delete keep latch state');
  // A configurable gate: the panel rewrites the pin set, the model follows it.
  const typeNumber = async (selector, text) => {
    await click(selector);
    await key('a', 'KeyA', 2);
    await cdp('Input.insertText', { text });
    for (const kind of ['rawKeyDown', 'char', 'keyUp']) {
      await cdp('Input.dispatchKeyEvent', { type: kind, key: 'Enter', code: 'Enter',
        text: kind === 'char' ? '\r' : undefined, windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    }
  };
  await action('new');
  // An empty document is fitted 1:1, so canvas coordinates address the grid directly.
  const origin = await evaluate(`(()=>{const r=document.getElementById('canvas').getBoundingClientRect();return {x:r.x,y:r.y}})()`);
  const spots = [['INPUT', 100, 60], ['INPUT', 100, 200], ['INPUT', 100, 340], ['AND', 400, 200], ['OUTPUT', 700, 200]];
  for (const [type, x, y] of spots) {
    await click(`[data-add="${type}"]`);
    const at = { x: origin.x + x + 40, y: origin.y + y + 30 };
    await mouse('mousePressed', at);
    await mouse('mouseReleased', at);
  }
  const gateAt = await saved();
  assert.deepEqual(gateAt.nodes.map(n => [n.x, n.y]), spots.map(([, x, y]) => [x, y]), 'components land on the grid');
  const [inA, inB, inC, gate, gateOut] = gateAt.nodes;
  const pinAt = (id, pin) => `.node[data-id="${id}"] [data-pin="${pin}"]`;
  const gatePins = async () => (await saved()).wires.filter(w => w.to.node === gate.id).map(w => w.to.pin);
  await click(`.node[data-id="${gate.id}"] .body`);
  assert.equal(await evaluate('document.querySelector("#input-count")?.value'), '2', 'the panel starts at two inputs');
  await typeNumber('#input-count', '3');
  assert.equal((await saved()).nodes.find(n => n.id === gate.id).inputs, 3);
  assert.equal(await count(`.node[data-id="${gate.id}"] [data-direction="in"]`), 3, 'the gate draws three input pins');
  await click(pinAt(inA.id, 'out'));
  await click(pinAt(gate.id, 'a'));
  await click(pinAt(inB.id, 'out'));
  await click(pinAt(gate.id, 'b'));
  await click(pinAt(inC.id, 'out'));
  await click(pinAt(gate.id, 'c'));
  await click(pinAt(gate.id, 'out'));
  await click(pinAt(gateOut.id, 'in'));
  assert.deepEqual(await gatePins(), ['a', 'b', 'c'], 'each extra pin takes one wire');
  assert.equal(await value(gateOut.id), '0');
  await action('poke-tool');
  await click(`.node[data-id="${inA.id}"] .body`);
  await click(`.node[data-id="${inB.id}"] .body`);
  assert.equal(await value(gateOut.id), '0', 'a zero on the third input still holds the gate');
  await click(`.node[data-id="${inC.id}"] .body`);
  assert.equal(await value(gateOut.id), '1', 'three high inputs drive the gate');
  await action('select-tool');
  await click(`.node[data-id="${gate.id}"] .body`);
  await typeNumber('#input-count', '2');
  const shrunk = await saved();
  assert.equal(shrunk.nodes.find(n => n.id === gate.id).inputs, undefined, 'the default count keeps no field');
  assert.deepEqual(await gatePins(), ['a', 'b'], 'the wire to the removed pin is gone');
  assert.equal(await count(`.node[data-id="${gate.id}"] [data-direction="in"]`), 2, 'the gate draws two input pins again');
  assert.equal(await value(gateOut.id), '1', 'the remaining drivers still work');
  assert.match(await evaluate('document.getElementById("toast").textContent'), /удалены/, 'the user learns about the dropped wires');
  await action('undo');
  assert.deepEqual(await gatePins(), ['a', 'b', 'c'], 'one undo restores the third wire');
  assert.equal(await value(gateOut.id), '1');
  await action('redo');
  assert.deepEqual(await gatePins(), ['a', 'b']);
  // A new pin has no driver: it reads as Z instead of being ignored or invented.
  await click(`.node[data-id="${gate.id}"] .body`);
  await typeNumber('#input-count', '3');
  assert.equal(await count(`.node[data-id="${gate.id}"] [data-direction="in"]`), 3);
  assert.equal(await value(gateOut.id), 'X', 'a floating extra input never turns into 1');
  console.log('PASS: gate input count rewrites pins, drops spare wires and keeps undo consistent');
  await action('rs-example');
  await click('.node[data-id="r"] .body');
  await click('.node[data-id="s"] .body');
  await click('.node[data-id="s"] .body');
  const exported = await saved();
  await action('new');
  await evaluate(`(()=>{const file=new File([${JSON.stringify(JSON.stringify(exported))}], 'latch.json',{type:'application/json'});const dt=new DataTransfer();dt.items.add(file);const input=document.querySelector('#file');input.files=dt.files;input.dispatchEvent(new Event('change'));})()`);
  await ready();
  assert.equal(await value('out-q'), '1');
  console.log('PASS: JSON import restores latch state');
  assert.deepEqual(errors, []);
  await action('poke-tool');
  const screenshot = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile('/tmp/web-logisim-editor.png', Buffer.from(screenshot.data, 'base64'));
  console.log('PASS: no browser exceptions; screenshot /tmp/web-logisim-editor.png');
}
finally {
  await cdp('Page.close').catch(() => {
  });
  ws.close();
}
