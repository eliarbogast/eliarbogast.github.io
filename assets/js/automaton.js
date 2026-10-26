/*
	Cellular-automaton background for eliarbogast.com

	Rule: the "Immigration" variant of Conway's Game of Life (B3/S23).
	Two species, ember and teal, follow the ordinary Life rule; a newborn
	cell takes the majority species of its three parents. Cells shift colour
	as they age, and dead cells leave a fading trail. Every colour is sampled
	from the original fluid-art background (assets/css/images/bg.webp).

	- Mouse movement (or a tap) seeds new cells.
	- New patches are sprinkled in now and then so the board never dies out.
	- With prefers-reduced-motion, a single still frame is drawn instead.
	- The button in the bottom-right corner pauses and resumes it.
*/

(function () {
	'use strict';

	var canvas = document.getElementById('automaton');
	if (!canvas || !canvas.getContext) return;

	var ctx = canvas.getContext('2d', { alpha: false });
	if (!ctx) return;

	// Tuning.
		var CELL = 6;           // CSS pixels per cell
		var STEP_MS = 450;      // milliseconds between generations
		var FADE_MS = 900;      // how slowly each cell eases toward its new colour (higher = softer)
		var SHARP = 3;          // canvas pixels per cell side: 1 = softest blur, 3+ = crisper cell edges
		var TRAIL = 24;         // generations a dead cell keeps glowing
		var SEED_EVERY = 45;    // generations between fresh seed patches
		var AGE_MAX = 40;       // age at which a living cell reaches its "old" colour

	// Palette (RGB), sampled from the fluid-art background.
		var BG = [11, 11, 9];
		var SPECIES = [
			null,
			{ // ember
				young: [226, 150, 92],
				adult: [213, 81, 55],
				old:   [165, 47, 52],
				trail: [78, 36, 30]
			},
			{ // teal
				young: [96, 194, 190],
				adult: [57, 158, 163],
				old:   [36, 130, 111],
				trail: [18, 56, 54]
			}
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

	// Grid state.
		var W = 0, H = 0, N = 0;
		var cur, nxt, age, heat, trailSp;
		var image, pixels;

	// Smoothing (purely visual; the automaton itself still updates in hard steps).
	// Each generation sets a target colour per cell; the colour actually on screen
	// eases toward it every frame, so cells glow in and fade out gradually and
	// overlapping fades blur one generation into the next.
		var target, dispR, dispG, dispB;
		var generation = 0, population = 0;

		function allocate(w, h) {
			var oldW = W, oldH = H, oCur = cur, oAge = age, oHeat = heat, oTrail = trailSp;

			W = w; H = h; N = w * h;
			cur = new Uint8Array(N);
			nxt = new Uint8Array(N);
			age = new Uint8Array(N);
			heat = new Uint8Array(N);
			trailSp = new Uint8Array(N);

			// Keep whatever was already on screen when the window resizes.
				if (oCur) {
					var cw = Math.min(oldW, W), ch = Math.min(oldH, H);
					for (var y = 0; y < ch; y++)
						for (var x = 0; x < cw; x++) {
							var o = y * oldW + x, n = y * W + x;
							cur[n] = oCur[o]; age[n] = oAge[o]; heat[n] = oHeat[o]; trailSp[n] = oTrail[o];
						}
				}

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

	// Drop a roughly circular patch of random cells.
		function seedPatch(cx, cy, r, density, tealShare) {
			var r2 = r * r;
			for (var dy = -r; dy <= r; dy++)
				for (var dx = -r; dx <= r; dx++) {
					if (dx * dx + dy * dy > r2 || Math.random() > density) continue;
					var x = (cx + dx + W) % W, y = (cy + dy + H) % H, i = y * W + x;
					cur[i] = Math.random() < tealShare ? 2 : 1;
					age[i] = 0;
				}
		}

		// Most patches are ember with a few teal cells; about one in four is mostly teal.
		function randomPatch(rMin, rMax) {
			var teal = Math.random() < 0.25 ? 0.85 : 0.08;
			seedPatch(Math.floor(rand(0, W)), Math.floor(rand(0, H)), Math.round(rand(rMin, rMax)), 0.45, teal);
		}

		function seedBoard() {
			var patches = Math.max(4, Math.round(N / 2500));
			for (var i = 0; i < patches; i++) randomPatch(6, 16);
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
				target[i] = c ? aliveLUT[c][age[i]]
					: heat[i] ? trailLUT[trailSp[i]][heat[i]]
					: BG_PACKED;
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
						col = ((255 << 24) | ((b + 0.5) << 16) | ((g + 0.5) << 8) | (r + 0.5)) >>> 0;

					// Fill this cell's SHARP x SHARP block.
						var p = y * SHARP * rowW + x * SHARP;
						for (var sy = 0; sy < SHARP; sy++, p += rowW)
							for (var sx = 0; sx < SHARP; sx++)
								pixels[p + sx] = col;
				}
			}
			ctx.putImageData(image, 0, 0);
		}

	// Sizing.
		function gridSize() {
			var w = document.documentElement.clientWidth || window.innerWidth,
				h = window.innerHeight;
			return [Math.max(1, Math.ceil(w / CELL)), Math.max(1, Math.ceil(h / CELL))];
		}

		function resize() {
			var size = gridSize();
			if (size[0] === W && size[1] === H) return;
			allocate(size[0], size[1]);
			render();
			present(1);
		}

	// Animation loop.
		var motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
		var running = false, last = 0, prevFrame = 0, raf = 0;

		function frame(now) {
			if (!running) return;
			if (!last) last = prevFrame = now;
			if (now - last >= STEP_MS) {
				// Skip ahead after a long pause (e.g. a background tab) instead of racing.
				last = now - last > STEP_MS * 3 ? now : last + STEP_MS;
				step();
				render();
			}
			var dt = Math.min(now - prevFrame, 100);
			prevFrame = now;
			present(1 - Math.exp(-dt / FADE_MS));
			raf = window.requestAnimationFrame(frame);
		}

		function start() {
			if (running) return;
			running = true;
			last = 0;
			raf = window.requestAnimationFrame(frame);
		}

		function stop() {
			running = false;
			window.cancelAnimationFrame(raf);
		}

		// Reduced motion: advance the board off-screen, then show one still frame.
		function still() {
			stop();
			for (var g = 0; g < 150; g++) step();
			render();
			present(1);
		}

	// Pause / play button (bottom-right). The choice is remembered per browser.
		var toggle = document.getElementById('bg-toggle'),
			userPaused = false;

		try { userPaused = window.localStorage.getItem('bg-paused') === '1'; } catch (e) {}

		function updateToggle() {
			if (!toggle) return;
			var label = userPaused ? 'Play background animation' : 'Pause background animation';
			toggle.hidden = !!(motion && motion.matches);   // nothing to pause with reduced motion
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

		function applyMotionPreference() {
			if (motion && motion.matches) still();
			else if (userPaused) stop();
			else start();
			updateToggle();
		}

	// Interaction: the cursor (or a tap) plants new cells.
		var lastSeed = 0;

		function seedAt(clientX, clientY, radius, count) {
			if (!running) return;
			var vw = document.documentElement.clientWidth || window.innerWidth,
				vh = window.innerHeight,
				cx = Math.floor(clientX / vw * W),
				cy = Math.floor(clientY / vh * H);
			var tealShare = Math.random() < 0.2 ? 0.9 : 0.1;
			for (var k = 0; k < count; k++) {
				var x = (cx + Math.round(rand(-radius, radius)) + W) % W,
					y = (cy + Math.round(rand(-radius, radius)) + H) % H,
					i = y * W + x;
				cur[i] = Math.random() < tealShare ? 2 : 1;
				age[i] = 0;
			}
		}

		window.addEventListener('pointermove', function (e) {
			if (e.pointerType !== 'mouse') return;
			var now = performance.now();
			if (now - lastSeed < 40) return;
			lastSeed = now;
			seedAt(e.clientX, e.clientY, 2, 5);
		}, { passive: true });

		window.addEventListener('pointerdown', function (e) {
			if (e.pointerType === 'mouse') return;
			seedAt(e.clientX, e.clientY, 4, 24);
		}, { passive: true });

		var resizeTimer = 0;
		window.addEventListener('resize', function () {
			window.clearTimeout(resizeTimer);
			resizeTimer = window.setTimeout(resize, 150);
		});

		if (motion) {
			if (motion.addEventListener) motion.addEventListener('change', applyMotionPreference);
			else if (motion.addListener) motion.addListener(applyMotionPreference);
		}

	// Go.
		var size = gridSize();
		allocate(size[0], size[1]);
		seedBoard();
		for (var warm = 0; warm < 12; warm++) step();   // skip the noisy first few generations
		render();
		present(1);
		applyMotionPreference();

})();
