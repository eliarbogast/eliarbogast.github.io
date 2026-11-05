/*
	Cellular-automaton backdrop for the pinball page (pinball/index.html).

	Rule: the "Immigration" variant of Conway's Game of Life (B3/S23).
	Two species, ember and teal, follow the ordinary Life rule; a newborn
	cell takes the majority species of its three parents. Cells shift colour
	as they age, and dead cells leave a fading trail. The colours are the
	pinball page's own (pinball/pinball.css).

	- New patches are sprinkled in now and then so the board never dies out.
	- Drawing is capped at about 25 frames a second so the game keeps the CPU.
	- With prefers-reduced-motion, a single still frame is drawn instead.
*/

(function () {
	'use strict';

	var canvas = document.getElementById('life');
	if (!canvas || !canvas.getContext) return;

	var ctx = canvas.getContext('2d', { alpha: false });
	if (!ctx) return;

	// Tuning.
		var CELL = 10;          // CSS pixels per cell
		var STEP_MS = 550;      // milliseconds between generations
		var FADE_MS = 1100;     // how slowly each cell eases toward its new colour (higher = softer)
		var DRAW_MS = 40;       // minimum milliseconds between frames
		var SHARP = 2;          // canvas pixels per cell side: 1 = softest blur, 3+ = crisper cell edges
		var TRAIL = 24;         // generations a dead cell keeps glowing
		var SEED_EVERY = 40;    // generations between fresh seed patches
		var AGE_MAX = 40;       // age at which a living cell reaches its "old" colour

	// Palette (RGB).
		var BG = [7, 6, 10];
		var SPECIES = [
			null,
			{ young: [244, 170, 130], adult: [232, 112, 79], old: [160, 64, 56], trail: [60, 28, 26] },   // ember
			{ young: [150, 215, 212], adult: [79, 183, 182], old: [40, 120, 112], trail: [14, 48, 48] }   // teal
		];

	// Colour lookup tables, packed as 32-bit ABGR (little-endian ImageData).
		function pack(c) {
			return ((255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;
		}

		function mix(a, b, t) {
			return [
				Math.round(a[0] + (b[0] - a[0]) * t),
				Math.round(a[1] + (b[1] - a[1]) * t),
				Math.round(a[2] + (b[2] - a[2]) * t)
			];
		}

		var BG_PACKED = pack(BG);
		var aliveLUT = [null], trailLUT = [null];

		for (var s = 1; s <= 2; s++) {
			var sp = SPECIES[s], alive = new Uint32Array(AGE_MAX + 1), trail = new Uint32Array(TRAIL + 1);

			for (var a = 0; a <= AGE_MAX; a++)
				alive[a] = pack(a < 4 ? mix(sp.young, sp.adult, a / 4) : mix(sp.adult, sp.old, (a - 4) / (AGE_MAX - 4)));

			for (var h = 0; h <= TRAIL; h++)
				trail[h] = pack(mix(BG, sp.trail, Math.pow(h / TRAIL, 2)));

			aliveLUT.push(alive);
			trailLUT.push(trail);
		}

	// Grid state. Each generation sets a target colour per cell; the colour actually
	// on screen eases toward it every frame, so cells glow in and fade out gradually.
		var W = 0, H = 0, N = 0, generation = 0, population = 0;
		var cur, nxt, age, heat, trailSp, target, dispR, dispG, dispB, image, pixels;

		function allocate() {
			W = Math.max(1, Math.ceil((document.documentElement.clientWidth || window.innerWidth) / CELL));
			H = Math.max(1, Math.ceil(window.innerHeight / CELL));
			N = W * H;
			cur = new Uint8Array(N);
			nxt = new Uint8Array(N);
			age = new Uint8Array(N);
			heat = new Uint8Array(N);
			trailSp = new Uint8Array(N);
			target = new Uint32Array(N);
			dispR = new Float32Array(N);
			dispG = new Float32Array(N);
			dispB = new Float32Array(N);

			canvas.width = W * SHARP;
			canvas.height = H * SHARP;
			image = ctx.createImageData(W * SHARP, H * SHARP);
			pixels = new Uint32Array(image.data.buffer);
		}

		function rand(lo, hi) {
			return lo + Math.random() * (hi - lo);
		}

	// Drop a roughly circular patch of random cells. Most are ember with a few teal
	// cells; about one in four is mostly teal.
		function randomPatch(rMin, rMax) {
			var r = Math.round(rand(rMin, rMax)), r2 = r * r,
				cx = Math.floor(rand(0, W)), cy = Math.floor(rand(0, H)),
				teal = Math.random() < 0.25 ? 0.85 : 0.08;

			for (var dy = -r; dy <= r; dy++)
				for (var dx = -r; dx <= r; dx++) {
					if (dx * dx + dy * dy > r2 || Math.random() > 0.45) continue;
					var i = ((cy + dy + H) % H) * W + (cx + dx + W) % W;
					cur[i] = Math.random() < teal ? 2 : 1;
					age[i] = 0;
				}
		}

	// One generation of Immigration Life on a torus.
		function step() {
			var pop = 0;

			for (var y = 0; y < H; y++) {
				var up = ((y - 1 + H) % H) * W, row = y * W, down = ((y + 1) % H) * W;

				for (var x = 0; x < W; x++) {
					var l = (x - 1 + W) % W, r = (x + 1) % W;
					var c0 = cur[up + l], c1 = cur[up + x], c2 = cur[up + r],
						c3 = cur[row + l],                  c4 = cur[row + r],
						c5 = cur[down + l], c6 = cur[down + x], c7 = cur[down + r];

					var n = (c0 > 0) + (c1 > 0) + (c2 > 0) + (c3 > 0) + (c4 > 0) + (c5 > 0) + (c6 > 0) + (c7 > 0);
					var i = row + x, me = cur[i];

					if (me) {
						if (n === 2 || n === 3) {
							nxt[i] = me;
							if (age[i] < AGE_MAX) age[i]++;
							pop++;
						}
						else {
							nxt[i] = 0;
							heat[i] = TRAIL;
							trailSp[i] = me;
						}
					}
					else if (n === 3) {
						var embers = (c0 === 1) + (c1 === 1) + (c2 === 1) + (c3 === 1) + (c4 === 1) + (c5 === 1) + (c6 === 1) + (c7 === 1);
						nxt[i] = embers >= 2 ? 1 : 2;
						age[i] = 0;
						heat[i] = 0;
						pop++;
					}
					else {
						nxt[i] = 0;
						if (heat[i]) heat[i]--;
					}
				}
			}

			var t = cur; cur = nxt; nxt = t;
			population = pop;
			generation++;

			// Keep the board alive.
				if (generation % SEED_EVERY === 0) randomPatch(4, 9);
				if (population < N * 0.015) for (var k = 0; k < 3; k++) randomPatch(5, 12);
		}

		// Work out each cell's target colour for the current generation.
		function render() {
			for (var i = 0; i < N; i++) {
				var c = cur[i];
				target[i] = c ? aliveLUT[c][age[i]] : heat[i] ? trailLUT[trailSp[i]][heat[i]] : BG_PACKED;
			}
		}

		// Ease every on-screen colour a fraction k of the way to its target (k = 1 snaps).
		function present(k) {
			var rowW = W * SHARP;
			for (var y = 0, i = 0; y < H; y++) {
				for (var x = 0; x < W; x++, i++) {
					var t = target[i],
						r = dispR[i] += ((t & 255) - dispR[i]) * k,
						g = dispG[i] += (((t >>> 8) & 255) - dispG[i]) * k,
						b = dispB[i] += (((t >>> 16) & 255) - dispB[i]) * k,
						col = ((255 << 24) | ((b + 0.5) << 16) | ((g + 0.5) << 8) | (r + 0.5)) >>> 0,
						p = y * SHARP * rowW + x * SHARP;

					for (var sy = 0; sy < SHARP; sy++, p += rowW)
						for (var sx = 0; sx < SHARP; sx++)
							pixels[p + sx] = col;
				}
			}
			ctx.putImageData(image, 0, 0);
		}

	// Fresh board: a few patches, then skip the noisy first generations.
		function startBoard() {
			allocate();
			for (var i = 0, patches = Math.max(4, Math.round(N / 1800)); i < patches; i++) randomPatch(5, 12);
			for (var warm = 0; warm < 12; warm++) step();
			render();
			present(1);
		}

	// Animation loop.
		var motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
		var running = false, lastStep = 0, lastDraw = 0, raf = 0;

		function frame(now) {
			if (!running) return;
			if (!lastStep) lastStep = lastDraw = now;
			if (now - lastStep >= STEP_MS) {
				// Skip ahead after a long pause (e.g. a background tab) instead of racing.
				lastStep = now - lastStep > STEP_MS * 3 ? now : lastStep + STEP_MS;
				step();
				render();
			}
			if (now - lastDraw >= DRAW_MS) {
				present(1 - Math.exp(-Math.min(now - lastDraw, 100) / FADE_MS));
				lastDraw = now;
			}
			raf = window.requestAnimationFrame(frame);
		}

		function apply() {
			window.cancelAnimationFrame(raf);
			running = !(motion && motion.matches);
			if (running) {
				lastStep = 0;
				raf = window.requestAnimationFrame(frame);
			}
		}

		var resizeTimer = 0;
		window.addEventListener('resize', function () {
			window.clearTimeout(resizeTimer);
			resizeTimer = window.setTimeout(startBoard, 200);
		});

		if (motion) {
			if (motion.addEventListener) motion.addEventListener('change', apply);
			else if (motion.addListener) motion.addListener(apply);
		}

	// Go. (Reduced motion: advance the board off-screen, then show one still frame.)
		startBoard();
		if (motion && motion.matches) {
			for (var g = 0; g < 150; g++) step();
			render();
			present(1);
		}
		apply();

})();
