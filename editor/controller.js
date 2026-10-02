import { TYPES, simulate } from '../simulator.js';
import { VARIABLE_GATES, inputCount, inputPins, MAX_INPUTS, MIN_INPUTS } from '../components.js';
import { toDocument, fromDocument } from '../circuit.js';
import { History } from './history.js';
import { loadDocument, saveDocument, readDocument, downloadDocument } from './storage.js';
import { Viewport } from './viewport.js';
import { createRenderer } from './renderer.js';
import { createElementCache } from './dom.js';
import { createRenderScheduler } from './render-scheduler.js';
import { snap, pinPoint, route, pathFor, nearestPoint, marqueeBox, itemsInBox } from '../geometry.js';
import { halfAdder, rsLatch } from '../examples.js';
export function startEditor() {
  const $ = createElementCache();
  const uid = () => crypto.randomUUID();
  let model;
  let values = {};
  let selected = new Set();
  let tool = 'select';
  let placing = null;
  let pending = null;
  let drag = null;
  let space = false;
  let paused = false;
  let dirty = true;
  let result = { stable: true, oscillating: [] };
  const history = new History();
  let toastTimer;
  const canvas = $('#canvas');
  const viewport = new Viewport(canvas, $('#viewport'), $('#grid'), $('#zoom-reset'));
  const renderer = createRenderer(() => ({ model, values, selected, primary: primary(), placing, paused, result, canUndo: history.canUndo, canRedo: history.canRedo }));
  const renderFrame = createRenderScheduler(render);
  const point = event => viewport.point(event);
  const fit = () => viewport.fit(model);
  const zoomAt = (...args) => viewport.zoomAt(...args);
  const renderProperties = () => renderer.properties();
  const library = query => renderer.library(query);
  function render() {
    renderFrame.cancel();
    if (dirty && !paused) {
      result = simulate(model.nodes, model.wires, values);
      values = result.values;
      dirty = false;
    }
    renderer.render();
  }
  const pin = (ref, out = false) => pinPoint(model.nodes, ref, out);
  const wireRoute = wire => route(pin(wire.from, true), pin(wire.to), wire.points);
  // Selection holds node and wire ids; single-item panels follow the primary one.
  const primary = () => (selected.size === 1 ? [...selected][0] : null);
  function select(...ids) {
    selected = new Set(ids.filter(id => id != null));
  }
  function selectAll() {
    select(...model.nodes.map(node => node.id), ...model.wires.map(wire => wire.id));
  }
  function notify(message) {
    $('#toast').textContent = message;
    $('#toast').style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('#toast').style.display = 'none', 4000);
  }
  function snapshot() {
    return { model, values };
  }
  function checkpoint() {
    history.checkpoint(snapshot());
  }
  function documentData() {
    return toDocument(model, values);
  }
  function save() {
    try {
      saveDocument(localStorage, documentData());
      $('#saved').textContent = 'Сохранено локально';
    }
    catch {
      $('#saved').textContent = 'Не удалось сохранить';
    }
  }
  function commit(electrical = true) {
    dirty ||= electrical;
    render();
    save();
  }
  function cancel() {
    pending = null;
    $('#preview').setAttribute('d', '');
  }
  function setTool(next) {
    cancel();
    placing = null;
    tool = next;
    $('#placement').innerHTML = '';
    canvas.dataset.tool = tool;
    for (const name of ['select', 'poke', 'wire', 'pan']) {
      const button = $(`#${name}-tool`);
      button.classList.toggle('active', name === tool);
      button.setAttribute('aria-pressed', String(name === tool));
    }
    $('#tool-hint').textContent = { select: 'Выбор: перемещение элементов и рамка выделения по пустому месту. Двойной щелчок по входу — 0 / 1.', poke: 'Входы: нажмите на входной контакт, чтобы переключить 0 / 1.', wire: 'Провод: пин → углы на поле → пин. Нажмите на провод для ответвления.', pan: 'Обзор: перетаскивайте поле. Колесо — масштаб.' }[tool];
    library($('#search').value);
    renderProperties();
  }
  function drawPreview(position) {
    if (!pending) {
      return;
    }
    const points = pending.points || [];
    const routePoints = pending.ref.direction === 'out' ? route(pin(pending.ref, true), position, points) : route(pin(pending.ref), position, points);
    $('#preview').setAttribute('d', pathFor(routePoints));
  }
  function drawMarquee(box) {
    const frame = $('#marquee');
    frame.setAttribute('x', box.x);
    frame.setAttribute('y', box.y);
    frame.setAttribute('width', box.width);
    frame.setAttribute('height', box.height);
    frame.style.display = 'block';
  }
  function hideMarquee() {
    $('#marquee').style.display = 'none';
  }
  function toggle(id) {
    const node = model.nodes.find(node => node.id === id);
    if (node?.type !== 'INPUT') {
      return;
    }
    checkpoint();
    node.value = 1 - node.value;
    commit();
  }
  function finishConnection(ref) {
    if (!pending) {
      return;
    }
    if (ref.direction === pending.ref.direction) {
      notify('Соедините выход со входом');
      return;
    }
    const from = ref.direction === 'out' ? ref : pending.ref;
    const to = ref.direction === 'in' ? ref : pending.ref;
    checkpoint();
    const points = pending.ref.direction === 'out' ? pending.points : [...(pending.points || [])].reverse();
    const editing = pending.editing;
    model.wires = model.wires.filter(wire => wire.id !== editing && !(wire.to.node === to.node && wire.to.pin === to.pin));
    const wire = { id: editing || uid(), from: { node: from.node, pin: from.pin }, to: { node: to.node, pin: to.pin }, ...(points?.length ? { points } : {}) };
    model.wires.push(wire);
    select(wire.id);
    cancel();
    commit();
  }
  function refAt(target) {
    const pinElement = target?.closest('[data-pin]');
    const nodeElement = target?.closest('.node');
    return pinElement && nodeElement ? { node: nodeElement.dataset.id, pin: pinElement.dataset.pin, direction: pinElement.dataset.direction } : null;
  }
  function place(position, repeat) {
    checkpoint();
    const type = placing;
    const node = { id: uid(), type, x: snap(position.x - 40), y: snap(position.y - 30), label: TYPES[type].name, value: 0 };
    model.nodes.push(node);
    select(node.id);
    if (!repeat) {
      setTool('select');
    }
    commit();
  }
  function handlePointerDown(event) {
    if (event.button !== 0 && event.button !== 1) {
      return;
    }
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    if (drag) {
      return;
    }
    const position = point(event);
    if (space || event.button === 1 || tool === 'pan') {
      drag = { pan: true, x: event.clientX, y: event.clientY, start: { ...viewport.offset } };
      drag.pointerId = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
      return;
    }
    if (placing) {
      place(position, event.shiftKey);
      return;
    }
    const nodeElement = event.target.closest('.node');
    const wireElement = event.target.closest('[data-wire]');
    const ref = refAt(event.target);
    if (tool === 'poke') {
      if (nodeElement) {
        select(nodeElement.dataset.id);
        toggle(nodeElement.dataset.id);
      }
      else {
        select();
      }
      render();
      return;
    }
    if (ref) {
      if (pending) {
        finishConnection(ref);
      }
      else {
        pending = { ref, points: [] };
        drag = { connection: true, x: event.clientX, y: event.clientY };
        drag.pointerId = event.pointerId;
        canvas.setPointerCapture(event.pointerId);
        drawPreview(position);
      }
      return;
    }
    if (pending) {
      pending.points.push({ x: snap(position.x), y: snap(position.y) });
      drawPreview(position);
      return;
    }
    if (tool === 'wire' && wireElement) {
      const wire = model.wires.find(wire => wire.id === wireElement.dataset.wire);
      const path = wireRoute(wire);
      const nearest = nearestPoint(path, position);
      pending = { ref: { ...wire.from, direction: 'out' }, points: [...path.slice(1, nearest.index), nearest.point] };
      select(wire.id);
      drawPreview(position);
      render();
      return;
    }
    const hit = nodeElement?.dataset.id || wireElement?.dataset.wire || null;
    if (hit && event.shiftKey) {
      if (selected.has(hit)) {
        selected.delete(hit);
      }
      else {
        selected.add(hit);
      }
      render();
      return;
    }
    if (!hit) {
      // Left button on empty canvas: frame selection, or a plain click that clears it.
      if (tool === 'select') {
        drag = { marquee: true, x: position.x, y: position.y, base: [...selected], additive: event.shiftKey, moved: false };
        drag.pointerId = event.pointerId;
        canvas.setPointerCapture(event.pointerId);
        return;
      }
      select();
      render();
      return;
    }
    if (!selected.has(hit)) {
      select(hit);
    }
    if (selected.size > 1) {
      drag = startGroupDrag(position);
    }
    else if (nodeElement) {
      const node = model.nodes.find(node => node.id === hit);
      drag = { node: node.id, x: position.x, y: position.y, start: { x: node.x, y: node.y }, saved: false };
    }
    else if (wireElement) {
      const wire = model.wires.find(wire => wire.id === hit);
      const handle = wireElement.dataset.handle;
      drag = { wire: wire.id, x: position.x, y: position.y, saved: false, index: handle === undefined ? null : Number(handle), start: handle === undefined ? position : (wire.points?.[Number(handle)] || { x: snap((pin(wire.from, true).x + pin(wire.to).x) / 2), y: snap((pin(wire.from, true).y + pin(wire.to).y) / 2) }) };
    }
    if (drag) {
      drag.pointerId = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
    }
    render();
  }
  canvas.addEventListener('pointerdown', handlePointerDown);
  // A group drag keeps the shape of the selection: chosen nodes move, and control
  // points of chosen wires (and of wires inside the group) follow the same offset.
  function startGroupDrag(position) {
    const group = new Set(selected);
    const origins = { nodes: [], points: [] };
    for (const node of model.nodes) {
      if (group.has(node.id)) {
        origins.nodes.push({ node, x: node.x, y: node.y });
      }
    }
    for (const wire of model.wires) {
      if (!group.has(wire.id) && !(group.has(wire.from.node) && group.has(wire.to.node))) {
        continue;
      }
      wire.points?.forEach((point, index) => origins.points.push({ wire, index, x: point.x, y: point.y }));
    }
    return { group: true, saved: false, x: position.x, y: position.y, origins };
  }
  function insertRoutePoint(wire, position) {
    let last = pin(wire.from, true);
    let best = Infinity;
    let index = 0;
    for (let i = 0; i <= wire.points.length; i++) {
      const next = wire.points[i];
      const part = next ? [last, { x: next.x, y: last.y }, next] : route(last, pin(wire.to));
      const distance = nearestPoint(part, position).distance;
      if (distance < best) {
        best = distance;
        index = i;
      }
      if (next) {
        last = next;
      }
    }
    wire.points.splice(index, 0, { ...position });
    return index;
  }
  function handlePointerMove(event) {
    const position = point(event);
    $('#pointer').textContent = `X: ${snap(position.x)} Y: ${snap(position.y)}`;
    if (placing) {
      $('#placement').innerHTML = renderer.ghost({ id: 'ghost', type: placing, x: snap(position.x - 40), y: snap(position.y - 30), label: TYPES[placing].name });
    }
    drawPreview({ x: snap(position.x), y: snap(position.y) });
    if (!drag || drag.connection) {
      return;
    }
    if (drag.pan) {
      viewport.offset = { x: drag.start.x + event.clientX - drag.x, y: drag.start.y + event.clientY - drag.y };
      viewport.update();
      return;
    }
    if (drag.marquee) {
      if (!drag.moved && Math.hypot(position.x - drag.x, position.y - drag.y) * viewport.zoom < 4) {
        return;
      }
      drag.moved = true;
      const box = marqueeBox({ x: drag.x, y: drag.y }, position);
      drawMarquee(box);
      const hits = itemsInBox(model, box);
      selected = drag.additive ? new Set([...drag.base, ...hits]) : new Set(hits);
      renderFrame.schedule();
      return;
    }
    if (!drag.saved && Math.hypot(position.x - drag.x, position.y - drag.y) * viewport.zoom < 4) {
      return;
    }
    if (!drag.saved) {
      checkpoint();
      drag.saved = true;
    }
    if (drag.group) {
      const dx = position.x - drag.x, dy = position.y - drag.y;
      for (const item of drag.origins.nodes) {
        item.node.x = snap(item.x + dx);
        item.node.y = snap(item.y + dy);
      }
      for (const item of drag.origins.points) {
        item.wire.points[item.index] = { x: snap(item.x + dx), y: snap(item.y + dy) };
      }
    }
    else if (drag.wire) {
      const wire = model.wires.find(wire => wire.id === drag.wire);
      wire.points ??= [];
      if (drag.index === null) {
        drag.index = insertRoutePoint(wire, drag.start);
      }
      wire.points[drag.index] = { x: snap(drag.start.x + position.x - drag.x), y: snap(drag.start.y + position.y - drag.y) };
    }
    else {
      const node = model.nodes.find(node => node.id === drag.node);
      node.x = snap(drag.start.x + position.x - drag.x);
      node.y = snap(drag.start.y + position.y - drag.y);
    }
    renderFrame.schedule();
  }
  canvas.addEventListener('pointermove', handlePointerMove);
  function endDrag(event) {
    const pointerId = event?.pointerId ?? drag?.pointerId;
    renderFrame.flush();
    if (drag?.marquee) {
      hideMarquee();
      // A cancelled frame restores the previous selection; a finished one keeps the hits.
      if (!drag.moved || event?.type !== 'pointerup') {
        selected = new Set(drag.additive ? drag.base : []);
      }
      render();
    }
    if (drag?.connection && event && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 5) {
      const ref = refAt(document.elementFromPoint(event.clientX, event.clientY));
      if (ref && pending && ref.direction !== pending.ref.direction) {
        finishConnection(ref);
      }
    }
    if (drag?.saved) {
      save();
    }
    drag = null;
    if (pointerId !== undefined && canvas.hasPointerCapture(pointerId)) {
      canvas.releasePointerCapture(pointerId);
    }
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', event => {
    endDrag();
    cancel();
  });
  canvas.addEventListener('lostpointercapture', () => {
    if (drag) {
      endDrag();
    }
  });
  canvas.addEventListener('pointerleave', () => {
    $('#placement').innerHTML = '';
  });
  canvas.addEventListener('dblclick', event => {
    if (tool !== 'select' || pending) {
      return;
    }
    const handle = event.target.closest('.wire-handle');
    if (handle) {
      const wire = model.wires.find(wire => wire.id === handle.dataset.wire);
      if (wire.points?.length) {
        checkpoint();
        wire.points.splice(Number(handle.dataset.handle), 1);
        commit(false);
      }
      return;
    }
    const node = event.target.closest('.node');
    if (node && !refAt(event.target)) {
      toggle(node.dataset.id);
    }
  });
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    const bounds = canvas.getBoundingClientRect();
    zoomAt(Math.exp(-event.deltaY * .001), event.clientX - bounds.left, event.clientY - bounds.top);
  }, { passive: false });
  $('#components').addEventListener('click', event => {
    const type = event.target.closest('[data-add]')?.dataset.add;
    if (!type) {
      return;
    }
    setTool('select');
    placing = type;
    select();
    canvas.dataset.tool = 'place';
    $('#tool-hint').textContent = `${TYPES[type].name}: нажмите на поле для размещения. Shift — несколько. Escape — отмена.`;
    library($('#search').value);
    renderProperties();
  });
  $('#search').addEventListener('input', event => library(event.target.value));
  $('#signals').addEventListener('click', event => {
    const id = event.target.closest('[data-toggle]')?.dataset.toggle;
    if (id) {
      toggle(id);
    }
  });
  $('#properties').addEventListener('click', event => {
    const id = primary();
    if (event.target.id === 'toggle-selected') {
      toggle(id);
    }
    if (event.target.id === 'reset-wire') {
      const wire = model.wires.find(wire => wire.id === id);
      if (wire?.points?.length) {
        checkpoint();
        delete wire.points;
        commit(false);
      }
    }
    if (event.target.id === 'reconnect-wire') {
      const wire = model.wires.find(wire => wire.id === id);
      setTool('wire');
      pending = { ref: { ...wire.from, direction: 'out' }, points: structuredClone(wire.points || []), editing: wire.id };
      notify('Выберите новый вход. Escape — оставить прежнее соединение.');
    }
  });
  // Fewer inputs means fewer pins, so wires on the removed pins have to go:
  // otherwise the document would no longer validate.
  function setInputCount(input) {
    const node = model.nodes.find(node => node.id === primary());
    const requested = Math.trunc(input.valueAsNumber);
    if (!node || !VARIABLE_GATES.includes(node.type) || !Number.isFinite(requested)) {
      renderProperties();
      return;
    }
    const count = Math.min(MAX_INPUTS, Math.max(MIN_INPUTS, requested));
    if (count === inputCount(node)) {
      renderProperties();
      return;
    }
    checkpoint();
    if (count === TYPES[node.type].inputs.length) {
      delete node.inputs;
    }
    else {
      node.inputs = count;
    }
    const pins = new Set(inputPins(node));
    const kept = model.wires.filter(wire => !(wire.to.node === node.id && !pins.has(wire.to.pin)));
    const dropped = model.wires.length - kept.length;
    model.wires = kept;
    select(node.id);
    commit(true);
    if (dropped) {
      notify(`Входов: ${count}. Провода к лишним входам удалены.`);
    }
  }
  $('#properties').addEventListener('change', event => {
    if (event.target.id === 'input-count') {
      setInputCount(event.target);
      return;
    }
    if (event.target.id !== 'label') {
      return;
    }
    const node = model.nodes.find(node => node.id === primary());
    if (!node) {
      return;
    }
    checkpoint();
    node.label = event.target.value.trim() || TYPES[node.type].name;
    commit(false);
  });
  $('#project-name').addEventListener('change', event => {
    checkpoint();
    model.name = event.target.value.trim() || 'Без названия';
    event.target.value = model.name;
    commit(false);
  });
  function remove() {
    if (!selected.size) {
      return;
    }
    checkpoint();
    model.nodes = model.nodes.filter(node => !selected.has(node.id));
    model.wires = model.wires.filter(wire => !selected.has(wire.id) && !selected.has(wire.from.node) && !selected.has(wire.to.node));
    select();
    cancel();
    commit();
  }
  function restore(direction) {
    endDrag();
    const restored = history[direction](snapshot());
    if (!restored) {
      return;
    }
    model = restored.model;
    values = restored.values;
    select();
    cancel();
    $('#project-name').value = model.name;
    commit();
  }
  for (const name of ['select', 'poke', 'wire', 'pan']) {
    $(`#${name}-tool`).onclick = () => setTool(name);
  }
  $('#undo').onclick = () => restore('undo');
  $('#redo').onclick = () => restore('redo');
  $('#delete').onclick = remove;
  $('#pause').onclick = () => {
    paused = !paused;
    $('#pause').textContent = paused ? '▶' : 'Ⅱ';
    $('#pause').title = paused ? 'Продолжить симуляцию' : 'Приостановить симуляцию';
    render();
    save();
  };
  $('#reset-sim').onclick = () => {
    checkpoint();
    values = {};
    commit();
    notify('Состояние сброшено. Для инициализации RS-триггера подайте S или R.');
  };
  $('#zoom-in').onclick = () => zoomAt(1.2);
  $('#zoom-out').onclick = () => zoomAt(1 / 1.2);
  $('#zoom-reset').onclick = () => zoomAt(1 / viewport.zoom);
  $('#fit').onclick = fit;
  function replace(data) {
    endDrag();
    checkpoint();
    ({ model, values } = fromDocument(data));
    paused = false;
    $('#pause').textContent = 'Ⅱ';
    select();
    setTool('select');
    $('#project-name').value = model.name;
    commit();
    fit();
  }
  $('#new').onclick = () => replace({ version: 1, name: 'Новая схема', nodes: [], wires: [] });
  $('#example').onclick = () => replace(halfAdder());
  $('#rs-example').onclick = () => {
    replace(rsLatch());
    setTool('poke');
    notify('R=1 сбрасывает Q. Выключите R, затем включите и выключите S: Q сохранит 1.');
  };
  $('#export').onclick = () => {
    downloadDocument(documentData());
    notify('Схема сохранена в JSON');
  };
  $('#import').onclick = () => $('#file').click();
  $('#file').onchange = async (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }
    try {
      replace(await readDocument(file));
      notify('Схема открыта');
    }
    catch (err) {
      notify('Не удалось открыть: ' + err.message);
    }
    event.target.value = '';
  };
  // Close menus after an action and keep only one menu open.
  document.addEventListener('click', event => {
    const action = event.target.closest('[data-action]');
    if (action) {
      $(`#${action.dataset.action}`).click();
    }
    if (event.target.closest('.menu button') || !event.target.closest('nav')) {
      document.querySelectorAll('nav details[open]').forEach(distance => distance.open = false);
    }
  });
  document.querySelectorAll('nav details').forEach(distance => distance.addEventListener('toggle', () => {
    if (distance.open) {
      document.querySelectorAll('nav details').forEach(other => {
        if (other !== distance) {
          other.open = false;
        }
      });
    }
  }));
  window.addEventListener('keydown', event => {
    if (['INPUT', 'TEXTAREA'].includes(event.target.tagName)) {
      return;
    }
    if (event.code === 'Space') {
      space = true;
      event.preventDefault();
    }
    if (event.key === 'Escape') {
      endDrag();
      setTool('select');
      select();
      render();
    }
    if (drag) {
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      remove();
    }
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      restore(event.shiftKey ? 'redo' : 'undo');
    }
    if (modifier && event.key.toLowerCase() === 's') {
      event.preventDefault();
      $('#export').click();
    }
    if (modifier && !event.altKey && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      selectAll();
      render();
    }
    if (modifier && event.altKey && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      $('#new').click();
    }
    if (!modifier && ['1', '2', '3', '4'].includes(event.key)) {
      setTool(['select', 'poke', 'wire', 'pan'][Number(event.key) - 1]);
    }
    if (event.key === '/') {
      event.preventDefault();
      $('#search').focus();
    }
  });
  window.addEventListener('keyup', event => {
    if (event.code === 'Space') {
      space = false;
    }
  });
  window.addEventListener('blur', () => {
    space = false;
    endDrag();
  });
  try {
    ({ model, values } = fromDocument(loadDocument(localStorage) || rsLatch()));
  }
  catch {
    model = rsLatch();
    notify('Сохранение недоступно или повреждено. Открыт пример RS-триггера.');
  }
  $('#project-name').value = model.name;
  setTool('select');
  render();
  save();
  requestAnimationFrame(fit);
}
