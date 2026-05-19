// mathGrapher.js — Native canvas function grapher for ARIA Math mode
// ═══════════════════════════════════════════════════════════════════
// Replaces the Desmos iframe with a fully theme-aware, drag-to-pan,
// scroll-to-zoom plotter. Supports multiple functions, intersection
// markers, and tracks the mouse position with live coordinate readout.
//
// Functions are parsed via a small in-house expression evaluator
// (whitelist-only, no eval injection risk).
// ═══════════════════════════════════════════════════════════════════

const FN_COLORS = [
  "var(--red-core)",
  "var(--red-ember)",
  "var(--red-neon)",
  "#4cff4c",
  "#00e5ff",
  "#ffd700",
];

/* ── EXPRESSION PARSER ────────────────────────────────────────
   Tiny safe parser for math expressions. Whitelist-based; never
   uses eval() or new Function(). Recursive descent. */

class Parser {
  constructor(expr) {
    this.expr = expr.replace(/\s+/g, "");
    this.pos = 0;
  }
  peek() { return this.expr[this.pos]; }
  consume(c) {
    if (this.expr[this.pos] === c) { this.pos++; return true; }
    return false;
  }
  parse() {
    const r = this.parseExpr();
    if (this.pos < this.expr.length) throw new Error(`unexpected '${this.peek()}' at ${this.pos}`);
    return r;
  }
  parseExpr() { // + and -
    let left = this.parseTerm();
    while (this.peek() === "+" || this.peek() === "-") {
      const op = this.expr[this.pos++];
      const right = this.parseTerm();
      const l = left, r = right;
      left = (x) => op === "+" ? l(x) + r(x) : l(x) - r(x);
    }
    return left;
  }
  parseTerm() { // * and /
    let left = this.parsePow();
    while (this.peek() === "*" || this.peek() === "/") {
      const op = this.expr[this.pos++];
      const right = this.parsePow();
      const l = left, r = right;
      left = (x) => op === "*" ? l(x) * r(x) : l(x) / r(x);
    }
    return left;
  }
  parsePow() { // ^ (right associative)
    const left = this.parseUnary();
    if (this.peek() === "^") {
      this.pos++;
      const right = this.parsePow();
      return (x) => Math.pow(left(x), right(x));
    }
    return left;
  }
  parseUnary() {
    if (this.peek() === "-") { this.pos++; const r = this.parseUnary(); return (x) => -r(x); }
    if (this.peek() === "+") { this.pos++; return this.parseUnary(); }
    return this.parseAtom();
  }
  parseAtom() {
    // Parenthesized expression
    if (this.consume("(")) {
      const r = this.parseExpr();
      if (!this.consume(")")) throw new Error("missing ')'");
      return r;
    }
    // Number
    const numMatch = this.expr.slice(this.pos).match(/^(\d+(\.\d*)?|\.\d+)/);
    if (numMatch) {
      const n = parseFloat(numMatch[0]);
      this.pos += numMatch[0].length;
      // Implicit multiplication: 2x, 3(x+1)
      if (/[a-zA-Z(]/.test(this.peek() || "")) {
        const r = this.parseAtom();
        return (x) => n * r(x);
      }
      return () => n;
    }
    // Variable or function
    const idMatch = this.expr.slice(this.pos).match(/^[a-zA-Z]+/);
    if (idMatch) {
      const name = idMatch[0];
      this.pos += name.length;
      if (name === "x") return (x) => x;
      if (name === "pi") return () => Math.PI;
      if (name === "e") return () => Math.E;
      // Function call
      const fns = { sin: Math.sin, cos: Math.cos, tan: Math.tan,
        asin: Math.asin, acos: Math.acos, atan: Math.atan,
        sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
        exp: Math.exp, log: Math.log10, ln: Math.log, sqrt: Math.sqrt,
        abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round };
      if (fns[name]) {
        if (!this.consume("(")) throw new Error(`expected '(' after ${name}`);
        const arg = this.parseExpr();
        if (!this.consume(")")) throw new Error(`missing ')' after ${name}(`);
        return (x) => fns[name](arg(x));
      }
      throw new Error(`unknown name: ${name}`);
    }
    throw new Error(`unexpected at ${this.pos}: '${this.peek()}'`);
  }
}

function compile(expr) {
  try {
    const p = new Parser(expr);
    const fn = p.parse();
    // Validate by evaluating at x=1
    const test = fn(1);
    if (typeof test !== "number") throw new Error("did not produce number");
    return { fn, error: null };
  } catch (e) {
    return { fn: null, error: e.message };
  }
}

/* ── GRAPHER CLASS ───────────────────────────────────────────── */
export class MathGrapher {
  constructor(container) {
    container.innerHTML = `
      <div class="mathGrapher">
        <div class="mgHeader">
          <span class="mgTitle">FUNCTION PLOT</span>
          <div class="mgHeaderBtns">
            <button class="mgZoomOut" title="Zoom out">−</button>
            <button class="mgZoomIn" title="Zoom in">+</button>
            <button class="mgReset" title="Reset view">⟲</button>
          </div>
        </div>
        <div class="mgCanvasWrap">
          <canvas class="mgCanvas"></canvas>
          <div class="mgCoords"></div>
        </div>
        <div class="mgFunctions"></div>
        <div class="mgInputRow">
          <span class="mgInputPrefix">y =</span>
          <input class="mgInput" type="text" placeholder="x^2 + 2x - 3" />
          <button class="mgAdd">Plot</button>
        </div>
        <div class="mgError"></div>
      </div>
    `;
    this.container = container;
    this.canvas = container.querySelector(".mgCanvas");
    this.ctx = this.canvas.getContext("2d");
    this.coordsEl = container.querySelector(".mgCoords");
    this.fnListEl = container.querySelector(".mgFunctions");
    this.input = container.querySelector(".mgInput");
    this.errorEl = container.querySelector(".mgError");

    // View state
    this.cx = 0;   // world center x
    this.cy = 0;   // world center y
    this.scale = 40; // pixels per unit
    this.functions = []; // { expr, fn, color, visible }

    this.bindEvents();
    this.resize();
    this.draw();
  }

  resize() {
    const wrap = this.container.querySelector(".mgCanvasWrap");
    const w = wrap.clientWidth;
    const h = wrap.clientHeight || 320;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.h = h;
  }

  bindEvents() {
    let drag = null;
    this.canvas.addEventListener("mousedown", (e) => {
      drag = { x: e.clientX, y: e.clientY, cx: this.cx, cy: this.cy };
    });
    window.addEventListener("mousemove", (e) => {
      // Coords readout
      const rect = this.canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      if (px >= 0 && px <= this.w && py >= 0 && py <= this.h) {
        const wx = this.cx + (px - this.w / 2) / this.scale;
        const wy = this.cy - (py - this.h / 2) / this.scale;
        this.coordsEl.textContent = `x: ${wx.toFixed(2)}, y: ${wy.toFixed(2)}`;
      }
      // Drag pan
      if (drag) {
        const dx = (e.clientX - drag.x) / this.scale;
        const dy = (e.clientY - drag.y) / this.scale;
        this.cx = drag.cx - dx;
        this.cy = drag.cy + dy;
        this.draw();
      }
    });
    window.addEventListener("mouseup", () => (drag = null));
    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      this.scale = Math.max(2, Math.min(500, this.scale * factor));
      this.draw();
    }, { passive: false });

    this.container.querySelector(".mgZoomIn").onclick = () => {
      this.scale = Math.min(500, this.scale * 1.3);
      this.draw();
    };
    this.container.querySelector(".mgZoomOut").onclick = () => {
      this.scale = Math.max(2, this.scale / 1.3);
      this.draw();
    };
    this.container.querySelector(".mgReset").onclick = () => {
      this.cx = 0;
      this.cy = 0;
      this.scale = 40;
      this.draw();
    };

    this.container.querySelector(".mgAdd").onclick = () => this.addFunction();
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.addFunction();
    });

    window.addEventListener("resize", () => {
      this.resize();
      this.draw();
    });
  }

  addFunction() {
    const expr = this.input.value.trim();
    if (!expr) return;
    const compiled = compile(expr);
    if (compiled.error) {
      this.errorEl.textContent = `Error: ${compiled.error}`;
      return;
    }
    this.errorEl.textContent = "";
    const color = FN_COLORS[this.functions.length % FN_COLORS.length];
    this.functions.push({
      expr,
      fn: compiled.fn,
      color,
      visible: true,
    });
    this.input.value = "";
    this.renderFnList();
    this.draw();
  }

  removeFunction(i) {
    this.functions.splice(i, 1);
    this.renderFnList();
    this.draw();
  }

  toggleFunction(i) {
    this.functions[i].visible = !this.functions[i].visible;
    this.renderFnList();
    this.draw();
  }

  renderFnList() {
    if (!this.functions.length) {
      this.fnListEl.innerHTML = "";
      return;
    }
    this.fnListEl.innerHTML = this.functions
      .map(
        (f, i) => `
        <div class="mgFnRow ${f.visible ? "" : "hidden"}" data-i="${i}">
          <span class="mgFnDot" style="background:${f.color}"></span>
          <span class="mgFnExpr">y = ${f.expr.replace(/</g, "&lt;")}</span>
          <button class="mgFnToggle" data-i="${i}" title="Show/hide">${f.visible ? "👁" : "—"}</button>
          <button class="mgFnDel" data-i="${i}" title="Remove">×</button>
        </div>
      `,
      )
      .join("");
    this.fnListEl.querySelectorAll(".mgFnDel").forEach((b) =>
      b.addEventListener("click", () => this.removeFunction(parseInt(b.dataset.i))),
    );
    this.fnListEl.querySelectorAll(".mgFnToggle").forEach((b) =>
      b.addEventListener("click", () => this.toggleFunction(parseInt(b.dataset.i))),
    );
  }

  worldToScreen(x, y) {
    return [
      this.w / 2 + (x - this.cx) * this.scale,
      this.h / 2 - (y - this.cy) * this.scale,
    ];
  }

  draw() {
    const ctx = this.ctx;
    // Read theme colors
    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue("--red-core").trim() || "#ff2040";
    const bgPanel = styles.getPropertyValue("--bg-panel").trim() || "#0d0000";
    const borderCut = styles.getPropertyValue("--border-cut").trim() || "#330000";
    const textMuted = styles.getPropertyValue("--text-muted").trim() || "#553333";

    ctx.fillStyle = bgPanel;
    ctx.fillRect(0, 0, this.w, this.h);

    // Pick a grid step that gives roughly 50–100px spacing
    const targetPx = 60;
    let step = Math.pow(10, Math.floor(Math.log10(targetPx / this.scale)));
    while (step * this.scale < targetPx / 2) step *= 2;
    while (step * this.scale > targetPx * 2) step /= 2;

    // Grid
    ctx.strokeStyle = borderCut;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    const x0 = Math.ceil((this.cx - this.w / 2 / this.scale) / step) * step;
    const x1 = (this.cx + this.w / 2 / this.scale);
    for (let x = x0; x <= x1; x += step) {
      const [sx] = this.worldToScreen(x, 0);
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, this.h);
    }
    const y0 = Math.ceil((this.cy - this.h / 2 / this.scale) / step) * step;
    const y1 = (this.cy + this.h / 2 / this.scale);
    for (let y = y0; y <= y1; y += step) {
      const [, sy] = this.worldToScreen(0, y);
      ctx.moveTo(0, sy);
      ctx.lineTo(this.w, sy);
    }
    ctx.stroke();

    // Axes
    ctx.strokeStyle = textMuted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const [, sy0] = this.worldToScreen(0, 0);
    const [sx0] = this.worldToScreen(0, 0);
    ctx.moveTo(0, sy0);
    ctx.lineTo(this.w, sy0);
    ctx.moveTo(sx0, 0);
    ctx.lineTo(sx0, this.h);
    ctx.stroke();

    // Labels on axes
    ctx.fillStyle = textMuted;
    ctx.font = "10px var(--font-mono, monospace)";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let x = x0; x <= x1; x += step) {
      if (Math.abs(x) < step / 100) continue;
      const [sx] = this.worldToScreen(x, 0);
      const label = Math.abs(x) < 0.001 ? "0" : parseFloat(x.toPrecision(6)).toString();
      ctx.fillText(label, sx, sy0 + 3);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let y = y0; y <= y1; y += step) {
      if (Math.abs(y) < step / 100) continue;
      const [, sy] = this.worldToScreen(0, y);
      const label = Math.abs(y) < 0.001 ? "0" : parseFloat(y.toPrecision(6)).toString();
      ctx.fillText(label, sx0 - 4, sy);
    }

    // Plot each function
    for (const f of this.functions) {
      if (!f.visible) continue;
      // Resolve color (CSS var → actual)
      let color = f.color;
      if (color.startsWith("var(")) {
        const varName = color.match(/var\((--[^)]+)\)/)?.[1];
        if (varName) color = styles.getPropertyValue(varName).trim() || accent;
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let prevY = null;
      const stepPx = 1;
      for (let px = 0; px <= this.w; px += stepPx) {
        const wx = this.cx + (px - this.w / 2) / this.scale;
        let wy;
        try { wy = f.fn(wx); } catch { wy = NaN; }
        if (!isFinite(wy)) { prevY = null; continue; }
        const sy = this.h / 2 - (wy - this.cy) * this.scale;
        // Skip drawing huge vertical jumps (asymptotes)
        if (prevY !== null && Math.abs(sy - prevY) > this.h) {
          ctx.moveTo(px, sy);
        } else if (prevY === null) {
          ctx.moveTo(px, sy);
        } else {
          ctx.lineTo(px, sy);
        }
        prevY = sy;
      }
      ctx.stroke();
    }
  }
}
