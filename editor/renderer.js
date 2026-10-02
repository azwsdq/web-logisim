import {TYPES, VARIABLE_GATES, inputCount, inputPins, MAX_INPUTS, MIN_INPUTS} from '../components.js';
import {indexCircuit, pinKey} from '../circuit.js';
import {snap, localPin, pinPoint, route, pathFor, junctions, bodySpan, nodeBox, LABEL_OFFSET} from '../geometry.js';
import {shape, color} from './symbols.js';
import {escapeHTML, setHTML, keyedLayer, createElementCache} from './dom.js';

const GROUP_NAMES = {
  'ВХОДЫ И ВЫХОДЫ': 'Входы и выходы',
  'ЛОГИЧЕСКИЕ ВЕНТИЛИ': 'Логические вентили',
  'ТРАНЗИСТОРЫ': 'Транзисторы',
};
const hasIndicator = node => node.type === 'INPUT' || node.type === 'OUTPUT';
const escape = escapeHTML;

function plural(count, forms) {
  const mod100 = count % 100, mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) {
    return `${count} ${forms[2]}`;
  }
  return `${count} ${forms[mod10 === 1 ? 0 : mod10 >= 2 && mod10 <= 4 ? 1 : 2]}`;
}

function pinCircles(x, y) {
  return `<circle class="pin-hit" cx="${x}" cy="${y}" r="9"/>
    <circle class="pin" cx="${x}" cy="${y}" r="3"/>`;
}

function signalClass(value) {
  switch (value) {
    case 1: return 'high-wire';
    case 0: return '';
    case 'Z': return 'floating-wire';
    default: return 'unknown-wire';
  }
}

export function createRenderer(readState) {
  const $ = createElementCache();
  const renderNodes = keyedLayer($('#nodes'));
  const wireLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const junctionLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  $('#wires').replaceChildren(wireLayer, junctionLayer);
  const renderWireItems = keyedLayer(wireLayer);
  const wireCache = new Map();
  let state, index;
  let lastGeometryKey = null;
  let junctionPoints = [];

  function sync() {
    state = readState();
    index = indexCircuit(state.model);
  }

  const pin = (reference, output = false) => pinPoint(index.nodes, reference, output);

  function inputMarkup(node, name) {
    const position = localPin(node, name);
    const wire = index.incoming.get(pinKey(node.id, name));
    const signal = wire ? state.values[wire.from.node] : 'Z';
    const leadEnd = ['OR', 'NOR', 'XOR'].includes(node.type) ? 17 : 10;
    const label = node.type.endsWith('MOS') ? (name === 'gate' ? 'G' : 'S') : '';
    return `<g data-pin="${name}" data-direction="in">
      <path d="M0 ${position.y} H${leadEnd}" stroke="${color(signal)}"/>
      ${pinCircles(0, position.y)}
      <text x="-5" y="${position.y - 5}" text-anchor="end" style="font-size:8px">${label}</text>
    </g>`;
  }

  function outputMarkup(node, name, value) {
    const leadStart = node.type === 'INPUT' ? 60 : ['NAND', 'NOR'].includes(node.type) ? 75 : 70;
    return `<g data-pin="${name}" data-direction="out">
      <path d="M${leadStart} 30 H80" stroke="${color(value)}"/>
      ${pinCircles(80, 30)}
    </g>`;
  }

  function nodeMarkup(node, ghost = false) {
    const definition = TYPES[node.type];
    const value = state.values[node.id] ?? 'X';
    const box = nodeBox(node);
    const selection = !ghost && state.selected.has(node.id)
      ? `<rect class="selection" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"/>` : '';
    const indicator = hasIndicator(node)
      ? `<text class="value" x="35" y="38" text-anchor="middle" style="fill:${color(value)}">${value}</text>` : '';
    // Input leads go under the body: a tall curved edge moves towards the pin line,
    // and the opaque fill hides the remainder of the lead.
    return `<g class="node" data-id="${escape(node.id)}" transform="translate(${node.x},${node.y})">
      ${selection}<text x="35" y="${bodySpan(node).top - LABEL_OFFSET}" text-anchor="middle">${escape(node.label)}</text>
      ${inputPins(node).map(name => inputMarkup(node, name)).join('')}
      ${shape(node)}${indicator}
      ${definition.outputs.map(name => outputMarkup(node, name, value)).join('')}
    </g>`;
  }

  function wireGeometry(wire) {
    const source = pin(wire.from, true), target = pin(wire.to);
    const key = JSON.stringify([wire.from, wire.to, source, target, wire.points]);
    const cached = wireCache.get(wire.id);
    if (cached?.key === key) return cached;
    const points = route(source, target, wire.points);
    const geometry = {key, points, path: pathFor(points)};
    wireCache.set(wire.id, geometry);
    return geometry;
  }

  function renderJunctions(geometries) {
    const geometryKey = JSON.stringify([...geometries].map(([id, geometry]) => [id, geometry.key]));
    if (geometryKey !== lastGeometryKey) {
      junctionPoints = junctions(state.model.wires.map(wire => ({...wire, route: geometries.get(wire.id).points})));
      lastGeometryKey = geometryKey;
    }
    setHTML(junctionLayer, junctionPoints.map(point =>
      `<circle class="junction" cx="${point.x}" cy="${point.y}" r="3" fill="${color(state.values[point.source])}"/>`).join(''));
  }

  function renderWireHandles() {
    // Route handles belong to a single chosen wire; a group has no shared handles.
    const wire = state.selected.size === 1 ? index.wires.get(state.primary) : null;
    if (!wire) {
      setHTML($('#wire-handles'), '');
      return;
    }
    const source = pin(wire.from, true), target = pin(wire.to);
    const handles = wire.points?.length ? wire.points : [{
      x: snap((source.x + target.x) / 2), y: snap((source.y + target.y) / 2),
    }];
    setHTML($('#wire-handles'), handles.map((point, index) =>
      `<circle class="wire-handle" data-wire="${escape(wire.id)}" data-handle="${index}"
        cx="${point.x}" cy="${point.y}" r="5">
        <title>Перетащить; двойной щелчок — удалить точку</title>
      </circle>`).join(''));
  }

  function renderWires() {
    const geometries = new Map(state.model.wires.map(wire => [wire.id, wireGeometry(wire)]));
    for (const id of wireCache.keys()) {
      if (!geometries.has(id)) wireCache.delete(id);
    }
    renderWireItems(state.model.wires, wire => wire.id, wire => {
      const path = geometries.get(wire.id).path;
      const classes = `wire ${signalClass(state.values[wire.from.node])} ${state.selected.has(wire.id) ? 'selected' : ''}`;
      return `<path class="wire-hit" data-wire="${escape(wire.id)}" d="${path}"/>
        <path class="${classes}" d="${path}"/>`;
    });
    renderJunctions(geometries);
    renderWireHandles();
  }

  function renderSignals() {
    const signals = state.model.nodes.filter(hasIndicator).map(node => {
      const value = state.values[node.id];
      const classes = `bit ${value === 1 ? 'on' : value === 0 ? '' : 'unknown'}`;
      const indicator = node.type === 'INPUT'
        ? `<button data-toggle="${escape(node.id)}" class="${classes}" aria-label="Переключить ${escape(node.label)}">${node.value}</button>`
        : `<span class="${classes}">${value ?? 'X'}</span>`;
      return `<div class="signal"><span>${escape(node.label)}
        <small>${node.type === 'INPUT' ? 'вход' : 'выход'}</small></span>${indicator}</div>`;
    });
    setHTML($('#signals'), signals.join('') || '<p class="property-note">Нет входов и выходов.</p>');
  }

  function nodeProperties(node) {
    const toggle = node.type === 'INPUT'
      ? '<button class="property-action" id="toggle-selected">Переключить 0 / 1</button>' : '';
    const count = VARIABLE_GATES.includes(node.type)
      ? `<tr><td>Входов</td><td><input id="input-count" type="number" min="${MIN_INPUTS}" max="${MAX_INPUTS}" step="1"
        aria-label="Число входов" value="${inputCount(node)}"></td></tr>` : '';
    const transistorNote = node.type.endsWith('MOS')
      ? '<p class="property-note">G — управление, S — сигнал. n-MOS открыт при G=1, p-MOS при G=0; закрытый ключ выдаёт Z. Цифровая однонаправленная модель.</p>' : '';
    return `<div class="property-title">${TYPES[node.type].name}</div>
      <table class="property-table">
        <tr><td>Метка</td><td><input id="label" aria-label="Метка компонента" maxlength="40" value="${escape(node.label)}"></td></tr>
        ${count}
        <tr><td>Выход</td><td>${state.values[node.id] ?? 'X'}</td></tr>
        <tr><td>Положение</td><td>${node.x}, ${node.y}</td></tr>
      </table>${toggle}${transistorNote}`;
  }

  function groupProperties() {
    const counts = ['nodes', 'wires'].map(kind => [...state.selected].filter(id => index[kind].has(id)).length);
    const parts = [plural(counts[0], ['компонент', 'компонента', 'компонентов']), plural(counts[1], ['провод', 'провода', 'проводов'])];
    return `<div class="property-title">Выделено элементов: ${state.selected.size}</div>
      <p class="property-note">${parts.join(', ')}. Перетаскивание перемещает всю группу, Delete удаляет её.
        Shift дополняет выделение, рамка по пустому месту задаёт его целиком.</p>`;
  }

  function renderProperties() {
    const node = index.nodes.get(state.primary);
    const wire = index.wires.get(state.primary);
    if (state.selected.size > 1) {
      setHTML($('#properties'), groupProperties());
    }
    else if (node) {
      setHTML($('#properties'), nodeProperties(node));
    } else if (wire) {
      setHTML($('#properties'), `<div class="property-title">Провод</div>
        <p class="property-note">Перетащите участок, чтобы изменить маршрут. Двойной щелчок по круглой точке удаляет её.</p>
        <button class="property-action" id="reset-wire">Сбросить маршрут</button>
        <button class="property-action" id="reconnect-wire">Переподключить вход</button>`);
    } else {
      const title = state.placing ? TYPES[state.placing].name : 'Ничего не выбрано';
      const hint = state.placing
        ? 'Нажмите на поле для размещения. Shift — разместить несколько компонентов. Escape — отмена.'
        : 'Выберите компонент или провод, чтобы изменить его свойства.';
      setHTML($('#properties'), `<div class="property-title">${title}</div><p class="property-note">${hint}</p>`);
    }
  }

  function libraryMarkup(query) {
    const groups = new Map();
    const search = query.toLowerCase();
    for (const [type, definition] of Object.entries(TYPES)) {
      if (!(type + ' ' + definition.name).toLowerCase().includes(search)) continue;
      if (!groups.has(definition.group)) groups.set(definition.group, []);
      groups.get(definition.group).push(`<button class="component ${state.placing === type ? 'active' : ''}"
        data-add="${type}" title="Разместить ${definition.name}">
        <svg viewBox="0 0 84 65">${shape({ type })}</svg><span>${definition.name}</span></button>`);
    }
    return [...groups].map(([name, items]) => `<details class="component-group" open>
      <summary>${GROUP_NAMES[name]}</summary><div class="component-list">${items.join('')}</div></details>`).join('')
      || '<p class="empty-library">Ничего не найдено</p>';
  }

  function renderStatus() {
    $('#sim-status').textContent = state.paused ? 'Пауза' : state.result.stable ? 'Симуляция активна' : 'Колебания · X';
    $('.live-dot').className = 'live-dot' + (state.paused ? ' paused' : !state.result.stable ? ' error' : '');
    $('#counts').textContent = `Элементов: ${state.model.nodes.length} · Проводов: ${state.model.wires.length}`;
    $('#undo').disabled = !state.canUndo;
    $('#redo').disabled = !state.canRedo;
    $('#delete').disabled = state.selected.size === 0;
  }

  return {
    render() {
      sync();
      renderNodes(state.model.nodes, node => node.id, nodeMarkup);
      renderWires();
      renderProperties();
      renderSignals();
      renderStatus();
    },
    properties() { sync(); renderProperties(); },
    library(query = '') { sync(); setHTML($('#components'), libraryMarkup(query)); },
    ghost(node) { sync(); return nodeMarkup(node, true); },
  };
}
