/*
	Generative grove background for eliarbogast.com

	Trees grow by space colonization: each limb reaches toward scattered points of
	"light" inside a crown, and its thickness follows the pipe model (a limb is as
	thick as the number of tips it carries, so limbs swell as the tree fills in).
	Six types (oak, birch, willow, shrub, hanging vine, reaching limb) are rooted at
	the screen edges and keep clear of the middle where the page content sits.

	- Once grown, a few faint pixel motes drift upward and, now and then, a signal
	  runs from a root out to a leaf. After about a minute the grove fades and regrows.
	- With prefers-reduced-motion, a single grown still frame is drawn instead.
	- The button in the bottom-right corner pauses and resumes it (state is remembered).
*/

(function () {
	'use strict';

	var bgEl = document.getElementById('bg-canopy'),
		canvas = document.getElementById('canopy'),
		fxc = document.getElementById('canopy-fx');
	if (!bgEl || !canvas || !canvas.getContext || !fxc) return;

	var ctx = canvas.getContext('2d'), fctx = fxc.getContext('2d');
	var W = 0, H = 0, DPR = 1, S = 1;

	var BG = [11, 11, 9];
	var COL = {
		bone: [184, 164, 128], boneDk: [118, 92, 66], birch: [206, 192, 160],
		moss: [122, 140, 86], mossDk: [78, 94, 62],
		leafA: [150, 168, 96], leafB: [200, 172, 108],
		berry: [92, 120, 200], pulse: [238, 222, 176]
	};

	function rnd(a, b) { return a + Math.random() * (b - a); }
	function lerpC(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
	function dim(c, f) { return lerpC(BG, c, f); }
	function rgba(c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')'; }
	function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

	/* Keeps the middle of the screen calm: true inside an ellipse around the content panel. */
	function inCenter(x, y, k) {
		var dx = (x - W / 2) / (W * 0.27 * k), dy = (y - H / 2) / (H * 0.30 * k);
		return dx * dx + dy * dy < 1;
	}

	function seg(x0, y0, x1, y1, w, col) {
		ctx.strokeStyle = rgba(col, 1);
		ctx.lineWidth = w;
		ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
	}

	function disc(x, y, r, col) {
		ctx.fillStyle = rgba(col, 1);
		ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
	}

	/* Tree types. Sizes are CSS px at scale 1; dens is attractor points per px^2 of crown. */
	var TYPES = {
		oak:    { kind: 'ground', cw: 400, ch: 280, trunk: 90,  dens: 1 / 620,  maxW: 13,  trop: [0, 0],     R: 120, kill: 9,  step: 2.8, twig: COL.moss,  bark: COL.boneDk, leaf: 0.85, stems: 1 },
		birch:  { kind: 'ground', cw: 130, ch: 460, trunk: 60,  dens: 1 / 800,  maxW: 6,   trop: [0, -0.05], R: 110, kill: 9,  step: 2.8, twig: COL.bone,  bark: COL.birch,  outline: 0.8, leaf: 0.6, stems: 1 },
		willow: { kind: 'ground', cw: 340, ch: 330, trunk: 100, dens: 1 / 820,  maxW: 9,   trop: [0, 0.5],   ramp: 90, R: 120, kill: 10, step: 2.8, twig: COL.leafA, bark: COL.boneDk, leaf: 0.9, stems: 1 },
		shrub:  { kind: 'ground', cw: 260, ch: 130, trunk: 0,   dens: 1 / 450,  maxW: 4.5, trop: [0, 0],     R: 70,  kill: 7,  step: 2.4, twig: COL.moss,  bark: COL.mossDk, leaf: 0.8,  stems: 3 },
		vine:   { kind: 'hang',   cw: 150, ch: 330, trunk: 0,   dens: 1 / 1800, maxW: 3,   trop: [0, 0.35],  ramp: 40, R: 100, kill: 9,  step: 2.6, twig: COL.leafA, bark: COL.mossDk, leaf: 0.7,  stems: 1 },
		limb:   { kind: 'side',   cw: 420, ch: 150, trunk: 0,   dens: 1 / 900,  maxW: 8,   trop: [0, 0],     R: 110, kill: 9,  step: 2.8, twig: COL.moss,  bark: COL.boneDk, leaf: 0.8,  stems: 1 }
	};

	var trees = [], leavesList = [], leafQ = [], fresh = [], thickQ = [], iter = 0;

	function key(cx, cy) { return cx * 10007 + cy; }

	function addNode(tr, x, y, parent) {
		var n = { x: x, y: y, p: parent, d: parent ? parent.d + 1 : 0, kids: 0, ax: 0, ay: 0, an: 0, st: 0, tc: 0, dw: 0, f: 1, tr: tr, q: 0 };
		tr.nodes.push(n);
		var k = key(Math.floor(x / tr.R), Math.floor(y / tr.R));
		(tr.grid[k] || (tr.grid[k] = [])).push(n);
		if (parent) parent.kids++;
		return n;
	}

	function makeTree(name, a) {
		var T = TYPES[name], tr = {
			name: name, T: T, nodes: [], grid: {}, att: [], R: T.R * S, kill: T.kill * S, step: T.step * 1.25 * S,
			trop: [T.trop[0], T.trop[1]], ramp: T.ramp || 0, maxW: T.maxW * S, twig: T.twig, bark: T.bark, done: false, stamp: 0,
			edge: dim(T.bark, T.outline || 0.42), core: lerpC(T.bark, COL.bone, 0.3)
		};
		var rx = T.cw * S * 0.7, ry = T.ch * S * 0.7, cx, cy, roots = [];
		if (T.kind === 'ground') {
			cx = a.x + rnd(-0.12, 0.12) * rx * 2; cy = H - T.trunk * S * 1.2 - ry;
			roots.push([a.x, H + 2]);
			for (var s = 1; s < T.stems; s++) roots.push([a.x + rnd(-0.6, 0.6) * rx, H + 2]);
		} else if (T.kind === 'hang') {
			cx = a.x + rnd(-0.2, 0.2) * rx; cy = ry + 4; roots.push([a.x, -2]);
		} else {
			cy = a.y; cx = a.side < 0 ? rx : W - rx; roots.push([a.side < 0 ? -2 : W + 2, a.y]);
			tr.trop[1] = rnd(-0.08, 0.08);
		}
		// Crowns are angular rather than round (a squarish diamond), and ground trees are narrower at the top.
		var n = Math.round(2.65 * rx * ry * T.dens), guard = 0;
		while (tr.att.length < n && guard++ < n * 40) {
			var u = rnd(-1, 1), v = rnd(-1, 1);
			if (Math.pow(Math.abs(u), 1.4) + Math.pow(Math.abs(v), 1.4) > 1) continue;
			var x = cx + u * rx * (T.kind === 'ground' ? 0.65 + 0.35 * (v + 1) / 2 : 1), y = cy + v * ry;
			if (x < -8 || x > W + 8 || y < -8 || y > H + 4) continue;
			if (inCenter(x, y, 1) && Math.random() < 0.92) continue;
			tr.att.push({ x: x, y: y, dead: false });
		}
		tr.k = tr.maxW / Math.sqrt(Math.max(8, tr.att.length * 0.3));
		roots.forEach(function (r) {
			var dx = cx - r[0], dy = cy - r[1], L = Math.sqrt(dx * dx + dy * dy), g = Math.floor(L / (26 * S));
			for (var i = 1; i <= g; i++) {
				var t = i / (g + 1), gx = r[0] + dx * t + rnd(-5, 5) * S, gy = r[1] + dy * t + rnd(-5, 5) * S;
				if (!inCenter(gx, gy, 1)) tr.att.push({ x: gx, y: gy, dead: false });
			}
			addNode(tr, r[0], r[1], null);
		});
		return tr;
	}

	function pick() {
		var r = Math.random();
		return r < 0.34 ? 'oak' : r < 0.58 ? 'birch' : r < 0.80 ? 'willow' : 'shrub';
	}

	function plan() {
		trees = []; leavesList = []; leafQ = []; fresh = []; thickQ = []; iter = 0;
		var list = [], per = W < 700 ? 1 : W < 1700 ? 2 : 3, side, i;

		// Ground trees in the side zones, a shrub or reaching limb now and then, and hanging vines from the top.
		for (side = -1; side <= 1; side += 2) {
			for (i = 0; i < per; i++) {
				var z0 = 0.02 + (0.26 / per) * i, fx = rnd(z0, z0 + 0.26 / per);
				list.push([pick(), { x: (side < 0 ? fx : 1 - fx) * W }]);
			}
			if (Math.random() < 0.6) list.push(['shrub', { x: (side < 0 ? rnd(0.1, 0.3) : rnd(0.7, 0.9)) * W }]);
			if (Math.random() < 0.7) list.push(['limb', { side: side, y: rnd(0.12, 0.55) * H }]);
		}
		for (i = Math.max(2, Math.round(W / 480)); i > 0; i--)
			list.push(['vine', { x: (Math.random() < 0.5 ? rnd(0.02, 0.28) : rnd(0.72, 0.98)) * W }]);

		list.forEach(function (it) { trees.push(makeTree(it[0], it[1])); });
	}

	/* Space colonization: one growth step for one tree. */
	function grow(tr) {
		var R = tr.R, att = tr.att, hit = [], i, j, k;
		tr.stamp++;
		for (i = 0; i < att.length; i++) {
			var a = att[i], cx = Math.floor(a.x / R), cy = Math.floor(a.y / R), best = null, bd = R * R;
			for (j = -1; j <= 1; j++) for (k = -1; k <= 1; k++) {
				var cell = tr.grid[key(cx + j, cy + k)];
				if (!cell) continue;
				for (var m = 0; m < cell.length; m++) {
					var n = cell[m], dx = a.x - n.x, dy = a.y - n.y, dd = dx * dx + dy * dy;
					if (dd < bd) { bd = dd; best = n; }
				}
			}
			if (!best) continue;
			if (bd < tr.kill * tr.kill) { a.dead = true; continue; }
			var dist = Math.sqrt(bd);
			if (best.st !== tr.stamp) { best.st = tr.stamp; best.ax = 0; best.ay = 0; best.an = 0; hit.push(best); }
			best.ax += (a.x - best.x) / dist; best.ay += (a.y - best.y) / dist; best.an++;
		}
		tr.att = att.filter(function (q) { return !q.dead; });
		if (!hit.length) { tr.done = true; return; }
		var added = 0;
		for (i = 0; i < hit.length; i++) {
			var h = hit[i], l = Math.sqrt(h.ax * h.ax + h.ay * h.ay);
			if (l < 0.01) continue;
			var f = tr.ramp ? clamp(h.d / tr.ramp, 0, 1) : 1, pdx = 0, pdy = 0;
			if (h.p) {   // keep some of the limb's own direction, so limbs run straighter
				pdx = h.x - h.p.x; pdy = h.y - h.p.y;
				var pl = Math.sqrt(pdx * pdx + pdy * pdy) || 1;
				pdx /= pl; pdy /= pl;
			}
			var ux = h.ax / l * 0.65 + pdx * 0.35 + rnd(-0.1, 0.1) + tr.trop[0] * f,
				uy = h.ay / l * 0.65 + pdy * 0.35 + rnd(-0.1, 0.1) + tr.trop[1] * f,
				ul = Math.sqrt(ux * ux + uy * uy) || 1;
			var nx = h.x + ux / ul * tr.step, ny = h.y + uy / ul * tr.step;
			if (nx < -20 || nx > W + 20 || ny < -20 || ny > H + 20) continue;
			var nn = addNode(tr, nx, ny, h);
			added++;
			nn.dw = Math.max(0.9, 0.5 * S);
			nn.f = 0; nn.t0 = tickN; nn.tw = tr.twig;
			fresh.push(nn);
		}
		if (!added) tr.done = true;
	}

	/* New limb segments extend over GROW_TICKS frames, so tips glide instead of stepping. */
	var GROW_TICKS = 4;

	function drawFresh(force) {
		var j = 0, i, n, p, f;
		for (i = 0; i < fresh.length; i++) {
			n = fresh[i]; p = n.p;
			f = force ? 1 : Math.min(1, (tickN - n.t0 + 1) / GROW_TICKS);
			if (f > n.f) {
				seg(p.x + (n.x - p.x) * n.f, p.y + (n.y - p.y) * n.f, p.x + (n.x - p.x) * f, p.y + (n.y - p.y) * f, n.dw, n.tw);
				n.f = f;
			}
			if (n.f < 1) fresh[j++] = n;
		}
		fresh.length = j;
	}

	/* Pipe model: a limb is as thick as the number of tips it carries. Limbs whose width has grown are
	   queued here and redrawn over the thin growth a few at a time (drawThick), so nothing jumps.
	   Thick limbs blend smoothly into a darker outline with a lighter core. */
	function thicken(tr, fin) {
		var N = tr.nodes, i, n;
		for (i = 0; i < N.length; i++) N[i].tc = 0;
		for (i = N.length - 1; i >= 0; i--) { n = N[i]; if (!n.kids) n.tc = 1; if (n.p) n.p.tc += n.tc; }
		for (i = 0; i < N.length; i++) {
			n = N[i];
			if (!n.p || n.f < 1) continue;
			n.nw = Math.min(tr.maxW, 0.9 + tr.k * Math.sqrt(n.tc - 1));
			if (!n.q && n.nw - n.dw > (fin ? 0.03 : 0.12)) { n.q = 1; thickQ.push(n); }   // unchanged limbs are not redrawn: repainting round caps over neighbours' cores makes joints flicker
		}
	}

	function drawThick(all) {
		if (!thickQ.length) return;
		var batch = thickQ.splice(0, all ? thickQ.length : Math.max(40, Math.ceil(thickQ.length / 24))), i, n, tr, q = Math.max(S, 0.8);
		for (i = 0; i < batch.length; i++) {
			n = batch[i]; tr = n.tr; n.q = 0;
			n.base = lerpC(tr.twig, tr.bark, clamp((n.nw - 0.8) / (tr.maxW * 0.7), 0, 1));
			n.s = clamp((n.nw - 2.2 * q) / (3 * q), 0, 1);
			seg(n.p.x, n.p.y, n.x, n.y, n.nw, n.s > 0 ? lerpC(n.base, tr.edge, n.s) : n.base);
		}
		for (i = 0; i < batch.length; i++) {
			n = batch[i];
			if (n.s > 0) seg(n.p.x, n.p.y, n.x, n.y, n.nw * (0.15 + 0.3 * n.s), lerpC(n.base, n.tr.core, n.s));
			n.dw = n.nw;
		}
	}

	/* Leaves are little angled ticks at the tips and along thin twigs, plus rare berries.
	   They are queued here and bud out gradually (drawLeaves) instead of appearing all at once. */
	function finish() {
		var leaf = [COL.leafA, COL.leafB, COL.moss], q = Math.max(S, 0.8), i, j, k;
		leafQ = [];
		trees.forEach(function (tr) {
			for (i = 0; i < tr.nodes.length; i++) {
				var n = tr.nodes[i];
				if (n.d < 12) continue;
				var tip = !n.kids;
				if (tip && n.d > 30) leavesList.push({ tr: tr, n: n });
				if (tip && Math.random() < 0.03) leafQ.push({ berry: true, x: n.x, y: n.y, r: 2.0 * q });
				else if (tip ? Math.random() < tr.T.leaf : (n.nw < 1.6 && Math.random() < 0.07 * tr.T.leaf)) {
					var c = tip ? 1 + ((Math.random() * 3) | 0) : 1;
					for (j = 0; j < c; j++)
						leafQ.push({ x: n.x + rnd(-3, 3) * q, y: n.y + rnd(-3, 3) * q, a: rnd(0, 6.28), len: rnd(2.5, 5) * q, w: 1.3 * q, col: leaf[(Math.random() * 3) | 0] });
				}
			}
		});
		for (i = leafQ.length - 1; i > 0; i--) { j = (Math.random() * (i + 1)) | 0; k = leafQ[i]; leafQ[i] = leafQ[j]; leafQ[j] = k; }
		leafPer = Math.max(1, Math.ceil(leafQ.length / 480));   // spread over about eight seconds
	}

	var leafPer = 1;

	function drawLeaves(all) {
		var c = all ? leafQ.length : leafPer, it;
		while (c-- > 0 && leafQ.length) {
			it = leafQ.pop();
			if (it.berry) { disc(it.x, it.y, it.r * 1.8, dim(COL.berry, 0.35)); disc(it.x, it.y, it.r, COL.berry); }
			else seg(it.x, it.y, it.x + Math.cos(it.a) * it.len, it.y + Math.sin(it.a) * it.len, it.w, it.col);
		}
	}

	/* One growth step for the whole grove; true once every tree has finished and the last tips have grown out. */
	function growAll() {
		iter++;
		var all = true, cut = iter > 900;
		trees.forEach(function (tr) {
			if (!tr.done && !cut) { grow(tr); if (!tr.done) all = false; }
		});
		var finished = (all || cut) && !fresh.length;
		if (finished || iter % 10 === 0) trees.forEach(function (tr) { thicken(tr, finished); });
		return finished;
	}

	/* Living details on the overlay: drifting motes and signal pulses. */
	var motes = [], pulses = [], sigTimer = 120;

	function newMote(m) {
		m.x = rnd(0, W); m.y = rnd(0, H); m.vx = rnd(-0.05, 0.05); m.vy = -rnd(0.08, 0.26);
		m.ph = rnd(0, 6.28); m.life = 0; m.max = rnd(500, 1100); m.a = rnd(0.25, 0.5);
		m.c = Math.random() < 0.7 ? COL.leafB : COL.leafA;
		return m;
	}

	function initMotes() {
		motes = [];
		var n = Math.round(W * H / 34000);
		for (var i = 0; i < n; i++) { var m = newMote({}); m.life = rnd(0, m.max); motes.push(m); }
		pulses = []; sigTimer = 120;
	}

	var TRAIL = 36;   // nodes of fading trail behind a signal

	function startPulse() {
		if (!leavesList.length) return;
		var L = leavesList[(Math.random() * leavesList.length) | 0], path = [], n = L.n;
		while (n) { path.push(n); n = n.p; }
		path.reverse();
		pulses.push({ path: path, i: 0, v: rnd(0.3, 0.5) });   // nodes per tick, about 60 to 100 px a second
	}

	function fxUpdate() {
		var i;
		for (i = 0; i < motes.length; i++) {
			var m = motes[i];
			m.ph += 0.01; m.x += m.vx + Math.sin(m.ph) * 0.12; m.y += m.vy; m.life++;
			if (m.life > m.max || m.y < -4) newMote(m);
		}
		if (phase === 'hold' && !leafQ.length && --sigTimer <= 0 && pulses.length < 2) { startPulse(); sigTimer = rnd(240, 540); }
		for (i = pulses.length - 1; i >= 0; i--) {
			pulses[i].i += pulses[i].v;
			if (pulses[i].i > pulses[i].path.length + TRAIL) pulses.splice(i, 1);
		}
	}

	// Position partway along a path of nodes (fractional index), so signals move smoothly.
	function along(path, f) {
		var last = path.length - 1, i = Math.floor(f), a = path[clamp(i, 0, last)], b = path[clamp(i + 1, 0, last)], t = f - i;
		return [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t];
	}

	function fxDraw() {
		fctx.setTransform(DPR, 0, 0, DPR, 0, 0);
		fctx.clearRect(0, 0, W, H);
		// Butt caps: the trail is many short translucent strokes, and round caps would double up the alpha
		// at every joint, making the trail strobe as it moves and blow out to near-opaque at the leaf.
		fctx.lineCap = 'butt';
		var i, k, px = Math.max(2, Math.round(2 * S));
		for (i = 0; i < motes.length; i++) {
			var m = motes[i];
			fctx.fillStyle = rgba(m.c, m.a * Math.sin(Math.PI * m.life / m.max));
			fctx.fillRect(m.x, m.y, px, px);
		}
		fctx.lineWidth = 1.6 * Math.max(S, 0.8);
		for (i = 0; i < pulses.length; i++) {
			var p = pulses[i], len = p.path.length,
				amp = 0.6 * Math.min(1, p.i / 12) * Math.min(1, (len + TRAIL - p.i) / TRAIL),   // fade in at the root, out past the leaf
				from = along(p.path, Math.min(p.i, len - 1));
			for (k = 1; k <= TRAIL; k++) {
				var f1 = p.i - k;
				if (f1 < 0) break;
				var to = along(p.path, Math.min(f1, len - 1));
				if (to[0] === from[0] && to[1] === from[1]) continue;   // head is past the leaf: nothing to draw
				fctx.strokeStyle = rgba(COL.pulse, amp * Math.pow(1 - (k - 0.5) / TRAIL, 1.5));
				fctx.beginPath(); fctx.moveTo(from[0], from[1]); fctx.lineTo(to[0], to[1]); fctx.stroke();
				from = to;
			}
		}
	}

	// Lifecycle: grow, hold, fade, regrow.
		var motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
		var HOLD = 3600, FADE = 220;      // ticks (60 per second) to hold the finished grove, then to fade it out
		var phase = 'grow', ph = 0, tickN = 0, acc = 0, prev = 0, running = false, raf = 0, userPaused = false;

		try { userPaused = window.localStorage.getItem('bg-paused') === '1'; } catch (e) {}

		function reduced() { return !!(motion && motion.matches); }

		function clearCanvas() {
			ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
			ctx.clearRect(0, 0, W, H);
			ctx.lineCap = 'round';
			fctx.clearRect(0, 0, fxc.width, fxc.height);
		}

		function toHold(still) {
			finish();
			if (still) drawLeaves(true);
			phase = still ? 'still' : 'hold';
			ph = 0;
		}

		// Grow the whole grove at once and show it as a still picture.
		function growInstantly() {
			var g = 0;
			while (!growAll() && g++ < 2000) drawFresh(true);
			drawThick(true);
			toHold(true);
			fctx.clearRect(0, 0, fxc.width, fxc.height);
		}

		function reset() {
			bgEl.style.transition = 'none';
			bgEl.style.opacity = '';
			void bgEl.offsetWidth;
			bgEl.style.transition = '';
			clearCanvas();
			plan();
			initMotes();
			phase = 'grow'; ph = 0;
			if (reduced() || userPaused) growInstantly();
		}

		function logic() {
			tickN++;
			drawThick(false);
			if (phase === 'grow') {
				if (tickN % GROW_TICKS === 0 && growAll()) toHold(false);
				else drawFresh(false);
			}
			else if (phase === 'hold') {
				drawLeaves(false);
				if (++ph > HOLD) { phase = 'fade'; ph = 0; bgEl.style.opacity = '0'; }
			}
			else if (phase === 'fade') { if (++ph > FADE) reset(); }
			fxUpdate();
		}

		function frame(now) {
			if (!running) return;
			if (!prev) prev = now;
			acc += Math.min(now - prev, 100);
			prev = now;
			while (acc >= 16.67) { acc -= 16.67; logic(); }
			fxDraw();
			raf = window.requestAnimationFrame(frame);
		}

		function start() {
			if (running) return;
			running = true; prev = 0;
			raf = window.requestAnimationFrame(frame);
		}

		function stop() {
			running = false;
			window.cancelAnimationFrame(raf);
		}

		// Pausing freezes the grove exactly as it is. Reduced motion, or a saved pause on load, shows a finished still picture.
		function applyMotionPreference() {
			if (reduced()) {
				stop();
				if (phase !== 'still') growInstantly();
			}
			else if (userPaused) {
				stop();
				if (phase === 'fade') reset();   // don't leave an empty screen behind a half-faded grove
			}
			else {
				if (phase === 'still') reset();
				start();
			}
			updateToggle();
		}

	// Pause / play button (bottom-right). The choice is remembered per browser.
		var toggle = document.getElementById('bg-toggle');

		function updateToggle() {
			if (!toggle) return;
			var label = userPaused ? 'Play background animation' : 'Pause background animation';
			toggle.hidden = reduced();   // nothing to pause with reduced motion
			toggle.setAttribute('aria-pressed', userPaused ? 'true' : 'false');
			toggle.setAttribute('aria-label', label);
			toggle.title = label;
			toggle.classList.toggle('is-paused', userPaused);
		}

		if (toggle)
			toggle.addEventListener('click', function () {
				userPaused = !userPaused;
				try { window.localStorage.setItem('bg-paused', userPaused ? '1' : '0'); } catch (e) {}
				applyMotionPreference();
			});

	// Sizing: regrow when the window changes shape (not for a phone's address bar sliding away).
		function measure() {
			DPR = Math.min(window.devicePixelRatio || 1, 2);
			W = document.documentElement.clientWidth || window.innerWidth;
			H = window.innerHeight;
			S = clamp(Math.min(W, H) / 720, 0.6, 1.4);
			canvas.width = fxc.width = Math.round(W * DPR);
			canvas.height = fxc.height = Math.round(H * DPR);
		}

		var resizeTimer = 0;
		window.addEventListener('resize', function () {
			window.clearTimeout(resizeTimer);
			resizeTimer = window.setTimeout(function () {
				var w = document.documentElement.clientWidth || window.innerWidth;
				if (w === W && Math.abs(window.innerHeight - H) < 120) return;
				measure();
				reset();
			}, 200);
		});

		if (motion) {
			if (motion.addEventListener) motion.addEventListener('change', applyMotionPreference);
			else if (motion.addListener) motion.addListener(applyMotionPreference);
		}

	// Go.
		measure();
		reset();
		applyMotionPreference();

})();
