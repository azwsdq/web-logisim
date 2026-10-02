import { nodeBounds } from '../geometry.js';

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;
export class Viewport {
  zoom = 1;
  offset = { x: 0, y: 0 };
  constructor(canvas, layer, grid, zoomLabel) {
    this.canvas = canvas;
    this.layer = layer;
    this.grid = grid;
    this.zoomLabel = zoomLabel;
  }
  update() {
    const transform = `translate(${this.offset.x},${this.offset.y}) scale(${this.zoom})`;
    this.layer.setAttribute('transform', transform);
    this.grid.setAttribute('patternTransform', transform);
    this.zoomLabel.textContent = `${Math.round(this.zoom * 100)}%`;
  }
  point(event) {
    const bounds = this.canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left - this.offset.x) / this.zoom,
      y: (event.clientY - bounds.top - this.offset.y) / this.zoom,
    };
  }
  zoomAt(factor, x, y) {
    const bounds = this.canvas.getBoundingClientRect();
    x ??= bounds.width / 2;
    y ??= bounds.height / 2;
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
    this.offset = {
      x: x - (x - this.offset.x) * next / this.zoom,
      y: y - (y - this.offset.y) * next / this.zoom,
    };
    this.zoom = next;
    this.update();
  }
  fit(model) {
    if (!model.nodes.length) {
      this.zoom = 1;
      this.offset = { x: 0, y: 0 };
      this.update();
      return;
    }
    const bounds = this.canvas.getBoundingClientRect();
    // Accumulate bounds: large imported routes must not overflow Math.min(...array).
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function include(point) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    // Component boxes, not origins: a gate body reaches far below its origin.
    model.nodes.forEach(node => include(nodeBounds(node)));
    for (const wire of model.wires) {
      wire.points?.forEach(include);
    }
    const margin = 22;
    minX -= margin;
    minY -= margin;
    maxX += margin;
    maxY += margin;
    this.zoom = Math.max(MIN_ZOOM, Math.min(1.25, (bounds.width - 60) / (maxX - minX), (bounds.height - 60) / (maxY - minY)));
    this.offset = {
      x: (bounds.width - (maxX - minX) * this.zoom) / 2 - minX * this.zoom,
      y: (bounds.height - (maxY - minY) * this.zoom) / 2 - minY * this.zoom,
    };
    this.update();
  }
}
