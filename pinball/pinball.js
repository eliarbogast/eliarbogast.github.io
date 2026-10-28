/*
	ELI · PINBALL  (prototype)
	A small retro pinball table for eliarbogast.com.

	- Physics: custom 2D (ball vs capsule walls, round bumpers, rotating flippers),
	  run in many small sub-steps per frame so a fast ball can't tunnel through anything.
	- Rendering: the flat table is drawn once to an off-screen texture, then painted
	  row-by-row in perspective (SNES "mode 7" style) so we look at the machine from the
	  front at an angle. Walls, bumpers, flippers and the ball are extruded/projected on top.
	- Look: low-res canvas, chunky pixels, synth sounds, then a VHS pass (chroma bleed,
	  tape noise, head-switching jitter) plus CSS scanlines.
	- Content: features show small, non-blocking info panels and promotions on the
	  backglass, filled from the main site's index.html so the game never goes out of date.

	Controls: A or ← = left flipper, D or → = right flipper, hold Space / ↓ = plunger,
	Shift = nudge (careful: TILT), M = mute. On touch: left / right half of the screen;
	hold the right half while the ball is in the lane to launch.
*/

(function () {
	'use strict';

	// =====================================================================
	// Table geometry (table units: 400 wide x 800 long; y grows toward the player)
	// =====================================================================

	const TW = 400, TL = 800;
	const BALL_R = 8;
	const GRAVITY = 980;          // down-slope pull, units/s²
	const MAX_SPEED = 2600;
	const STEP = 1 / 900;         // physics step (s)

	const PAL = {
		ember: '#e8704f', emberDeep: '#a52f34', gold: '#f2c27a', teal: '#4fb7b6', tealDeep: '#1f6f6a',
		ink: '#f2ede4', violet: '#2a1636', night: '#0c0912', chrome: '#c9c2cc'
	};

	const walls = [];
	const bumpers = [];
	const sensors = [];

	function wall(ax, ay, bx, by, o) {
		o = o || {};
		const w = {
			ax, ay, bx, by,
			r: o.r != null ? o.r : 3, e: o.e != null ? o.e : 0.42, h: o.h != null ? o.h : 16,
			kind: o.kind || 'wall', oneWay: !!o.oneWay, onHit: o.onHit || null, active: true,
			outer: !!o.outer, hidden: !!o.hidden, color: o.color || null, label: o.label || null, flash: 0
		};
		walls.push(w);
		return w;
	}

	function polyline(pts, o) {
		const out = [];
		for (let i = 0; i < pts.length - 1; i++) out.push(wall(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], o));
		return out;
	}

	// Outer shell: left wall, top arch, right wall.
		polyline([[20, 600], [20, 180]], { outer: true, h: 26, r: 4 });
		(function () {
			const pts = [];
			for (let i = 0; i <= 28; i++) {
				const th = Math.PI + (i / 28) * Math.PI;
				pts.push([200 + 180 * Math.cos(th), 180 + 180 * Math.sin(th)]);
			}
			polyline(pts, { outer: true, h: 26, r: 4 });
		})();
		polyline([[380, 180], [380, 800]], { outer: true, h: 26, r: 4 });

	// Plunger lane (right side) with a one-way gate at the top.
		wall(345, 255, 345, 800, { h: 18, r: 3 });
		wall(378, 236, 347, 252, { oneWay: true, h: 6, r: 2, hidden: true });   // slopes left, back into play
		const plungerFloor = wall(347, 784, 378, 784, { h: 0, r: 2, kind: 'plunger', hidden: true });

	// Inlane guides down to the flippers.
		wall(20, 600, 112, 690, { h: 16 });
		wall(345, 600, 253, 690, { h: 16 });

	// Slingshots: two passive edges + one kicking edge each.
		function sling(A, B, C, side) {
			wall(A[0], A[1], B[0], B[1], { h: 14, r: 4 });
			wall(B[0], B[1], C[0], C[1], { h: 14, r: 4 });
			return wall(A[0], A[1], C[0], C[1], { h: 14, r: 5, e: 0.5, kind: 'sling', color: PAL.ember, onHit: slingHit, label: side });
		}
		const slingL = sling([52, 520], [52, 592], [96, 622], 'L');
		const slingR = sling([313, 520], [313, 592], [269, 622], 'R');

	// Top lanes (three rollovers) separated by short posts.
		[122.5, 162.5, 202.5, 242.5].forEach(x => wall(x, 50, x, 100, { h: 14, r: 3 }));
		const lanes = [142.5, 182.5, 222.5].map((x, i) => {
			const s = { x, y: 80, r: 12, kind: 'lane', index: i, inside: false };
			sensors.push(s);
			return s;
		});

	// Pop bumpers.
		[[140, 205], [226, 205], [183, 275]].forEach(([x, y]) => bumpers.push({ x, y, r: 21, h: 22, kick: 720, flash: 0 }));

	// Left orbit lane with a spinner across it.
		wall(80, 140, 80, 255, { h: 16, r: 3 });
		const spinner = { x1: 25, x2: 76, y: 196, angle: 0, omega: 0, halfTurns: 0 };

	// Inlane rollovers (raise the bonus multiplier).
		const inlanes = [{ x: 36, y: 598 }, { x: 329.5, y: 598 }].map(p => {
			const s = { x: p.x, y: p.y, r: 9, kind: 'inlane', inside: false, flash: 0 };
			sensors.push(s);
			return s;
		});

	// "Glider": a Game of Life glider that drifts across the upper playfield. Hit it!
		const glider = { x: 182, y: 148, vx: 55, r: 15, minX: 145, maxX: 220, phase: 0, flash: 0, cooldown: 0, hits: 0 };
		const GLIDER_PHASES = [
			[[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]],
			[[0, 1], [2, 1], [1, 2], [2, 2], [1, 3]],
			[[2, 1], [0, 2], [2, 2], [1, 3], [2, 3]],
			[[1, 1], [2, 2], [3, 2], [1, 3], [2, 3]]
		];

	// Saucer (kick-out hole) → Projects.
		const saucer = { x: 62, y: 340, r: 11, kind: 'saucer', inside: false };
		sensors.push(saucer);

	// CV standup targets (left), ELI drop targets (right).
		const cvTargets = [
			wall(28, 412, 28, 438, { h: 16, r: 3, kind: 'standup', color: PAL.teal, onHit: cvHit, label: 'C' }),
			wall(28, 452, 28, 478, { h: 16, r: 3, kind: 'standup', color: PAL.teal, onHit: cvHit, label: 'V' })
		];
		const dropTargets = [
			wall(334, 300, 334, 326, { h: 18, r: 4, kind: 'drop', color: PAL.ember, onHit: dropHit, label: 'E' }),
			wall(334, 338, 334, 364, { h: 18, r: 4, kind: 'drop', color: PAL.ember, onHit: dropHit, label: 'L' }),
			wall(334, 376, 334, 402, { h: 18, r: 4, kind: 'drop', color: PAL.ember, onHit: dropHit, label: 'I' })
		];

	// Flippers.
		function makeFlipper(px, py, rest, up) {
			return { x: px, y: py, len: 64, rBase: 9, rTip: 5, rest, up, angle: rest, omega: 0, pressed: false, sign: Math.sign(up - rest) };
		}
		const flipL = makeFlipper(112, 690, 0.50, -0.45);
		const flipR = makeFlipper(253, 690, Math.PI - 0.50, Math.PI + 0.45);
		const flippers = [flipL, flipR];
		const FLIP_UP_SPEED = 26, FLIP_DOWN_SPEED = 16;

	// =====================================================================
	// Game state
	// =====================================================================

	const ball = { x: 362, y: 775, vx: 0, vy: 0, captured: false };

	const game = {
		mode: 'attract',          // attract | lane | play | drained | over
		score: 0, ballNum: 1, balls: 3, hi: 0,
		laneLit: [false, false, false], cvLit: [false, false], projectIndex: 0,
		plungerCharging: false, plungerPower: 0,
		saveUntil: 0, stillTime: 0, time: 0, startTime: 0,
		message: [], messageUntil: 0,
		popups: [], glitch: 0, shake: 0,
		bonus: 0, mult: 1, skillLane: -1, skillUntil: 0,
		rank: 0, frenzyUntil: 0, shots: [], nextShot: 0, tiltMeter: 0, tilted: false
	};

	// Top-5 scores, saved in this browser.
	let topScores = [];
	try {
		topScores = JSON.parse(localStorage.getItem('eli-pinball-scores') || '[]');
		const oldHi = parseInt(localStorage.getItem('eli-pinball-hi') || '0', 10);
		if (!topScores.length && oldHi) topScores = [{ s: oldHi, d: '' }];
	} catch (e) { topScores = []; }
	game.hi = topScores.length ? topScores[0].s : 0;

	function saveScore(score) {
		const d = new Date();
		const tag = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getMonth()] + ' ' + d.getDate();
		const entry = { s: score, d: tag };
		topScores.push(entry);
		topScores.sort((a, b) => b.s - a.s);
		topScores = topScores.slice(0, 5);
		game.hi = topScores[0].s;
		try { localStorage.setItem('eli-pinball-scores', JSON.stringify(topScores)); } catch (e) {}
		return topScores.indexOf(entry) + 1;          // 0 = didn't make the list
	}

	const frenzy = () => game.time < game.frenzyUntil;

	// Backglass "dot-matrix" messages, shown one at a time.
	const marquee = { queue: [], cur: null, t: 0 };
	function backglass(title, sub, secs, urgent) {
		if (urgent) { marquee.queue = []; marquee.cur = null; }          // big moments interrupt
		if (marquee.queue.length > 3) marquee.queue.shift();
		marquee.queue.push({ title, sub: sub || '', secs: secs || 2.5 });
	}

	const TOUCH = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
	const LAUNCH_HINT = TOUCH ? 'HOLD RIGHT SIDE' : 'HOLD SPACE';

	function say(lines, seconds) {
		game.message = lines;
		game.messageUntil = game.time + (seconds || 3);
	}

	function idleMessage() {
		if (game.mode === 'attract' || game.mode === 'over') {
			// Alternate the start prompt with the top scores.
			const slot = Math.floor(game.time / 2.5) % (topScores.length + 1);
			if (slot === 0 || !topScores.length) return TOUCH ? ['TAP', 'TO PLAY'] : ['PRESS SPACE', 'TO PLAY'];
			const t = topScores[slot - 1];
			return ['#' + slot + '  ' + t.s.toLocaleString('en-US'), t.d];
		}
		if (game.mode === 'lane') return [LAUNCH_HINT, 'TO LAUNCH'];
		if (game.tilted) return ['TILT', 'WAIT FOR THE BALL'];
		if (frenzy()) return ['GLIDER GUN!', Math.ceil(game.frenzyUntil - game.time) + 's  X2 SCORE'];
		const hints = [
			['SHOOT THE SAUCER', 'FOR PROJECTS'],
			['HIT C + V', 'FOR THE CV'],
			['LIGHT 3 LANES', 'FOR MUSIC'],
			['DROP E-L-I', 'TO SAY HI'],
			['HIT THE GLIDER 3X', 'FOR GLIDER GUN'],
			['FEATURES EARN', 'PROMOTIONS'],
			['SHIFT TO NUDGE', "DON'T TILT"]
		];
		return hints[Math.floor(game.time / 4) % hints.length];
	}

	function addScore(points, x, y) {
		if (game.tilted) return;
		if (frenzy()) points *= 2;
		game.score += points;
		if (x != null) game.popups.push({ x, y, text: String(points), t: 0 });
	}

	// =====================================================================
	// Physics
	// =====================================================================

	function closestOnSegment(px, py, ax, ay, bx, by) {
		const dx = bx - ax, dy = by - ay;
		const len2 = dx * dx + dy * dy;
		let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
		t = t < 0 ? 0 : t > 1 ? 1 : t;
		return [ax + dx * t, ay + dy * t, t];
	}

	function collideWall(w) {
		if (!w.active) return;
		const c = closestOnSegment(ball.x, ball.y, w.ax, w.ay, w.bx, w.by);
		let dx = ball.x - c[0], dy = ball.y - c[1];
		const R = BALL_R + w.r;
		const d2 = dx * dx + dy * dy;
		if (d2 >= R * R || d2 === 0) return;
		if (w.oneWay) {                                           // gate only stops balls falling back down
			if (ball.vy <= 0) return;
			const ly = w.ay + (w.by - w.ay) * (ball.x - w.ax) / (w.bx - w.ax);
			if (ball.y > ly) return;
		}
		const dist = Math.sqrt(d2);
		const nx = dx / dist, ny = dy / dist;
		ball.x += nx * (R - dist);
		ball.y += ny * (R - dist);
		const vn = ball.vx * nx + ball.vy * ny;
		if (vn < 0) {
			ball.vx -= (1 + w.e) * vn * nx;
			ball.vy -= (1 + w.e) * vn * ny;
			ball.vx *= 0.995; ball.vy *= 0.995;
			if (w.onHit) w.onHit(w, -vn, nx, ny);
		}
	}

	function collideBumper(b) {
		const dx = ball.x - b.x, dy = ball.y - b.y;
		const R = BALL_R + b.r;
		const d2 = dx * dx + dy * dy;
		if (d2 >= R * R || d2 === 0) return;
		const dist = Math.sqrt(d2);
		const nx = dx / dist, ny = dy / dist;
		ball.x += nx * (R - dist);
		ball.y += ny * (R - dist);
		const vn = ball.vx * nx + ball.vy * ny;
		// Reflect, then make sure the ball leaves at least at the kick speed.
		const out = Math.max(-vn * 0.6, 0) + b.kick;
		ball.vx += (out - vn) * nx;
		ball.vy += (out - vn) * ny;
		b.flash = 0.14;
		addScore(1000, b.x, b.y);
		Sound.bumper();
		game.shake = Math.max(game.shake, 1.5);
	}

	function updateFlipper(f, dt) {
		const target = f.pressed ? f.up : f.rest;
		const speed = f.pressed ? FLIP_UP_SPEED : FLIP_DOWN_SPEED;
		const prev = f.angle;
		const diff = target - f.angle;
		const stepMax = speed * dt;
		f.angle += Math.abs(diff) <= stepMax ? diff : Math.sign(diff) * stepMax;
		f.omega = (f.angle - prev) / dt;
	}

	function collideFlipper(f) {
		const tx = f.x + Math.cos(f.angle) * f.len, ty = f.y + Math.sin(f.angle) * f.len;
		const c = closestOnSegment(ball.x, ball.y, f.x, f.y, tx, ty);
		const rad = f.rBase + (f.rTip - f.rBase) * c[2];
		let dx = ball.x - c[0], dy = ball.y - c[1];
		const R = BALL_R + rad;
		const d2 = dx * dx + dy * dy;
		if (d2 >= R * R || d2 === 0) return;
		const dist = Math.sqrt(d2);
		const nx = dx / dist, ny = dy / dist;
		ball.x += nx * (R - dist);
		ball.y += ny * (R - dist);
		// Velocity of the flipper's surface at the contact point.
		const rx = c[0] - f.x, ry = c[1] - f.y;
		const svx = -ry * f.omega, svy = rx * f.omega;
		const rel = (ball.vx - svx) * nx + (ball.vy - svy) * ny;
		if (rel < 0) {
			const e = 0.28;
			ball.vx -= (1 + e) * rel * nx;
			ball.vy -= (1 + e) * rel * ny;
		}
	}

	function updateGlider(dt) {
		glider.x += glider.vx * dt;
		if (glider.x < glider.minX) { glider.x = glider.minX; glider.vx = Math.abs(glider.vx); }
		if (glider.x > glider.maxX) { glider.x = glider.maxX; glider.vx = -Math.abs(glider.vx); }
		if (glider.cooldown > 0) glider.cooldown -= dt;
	}

	function collideGlider() {
		const dx = ball.x - glider.x, dy = ball.y - glider.y;
		const R = BALL_R + glider.r;
		const d2 = dx * dx + dy * dy;
		if (d2 >= R * R || d2 === 0) return;
		const dist = Math.sqrt(d2);
		const nx = dx / dist, ny = dy / dist;
		ball.x += nx * (R - dist);
		ball.y += ny * (R - dist);
		const rel = (ball.vx - glider.vx) * nx + ball.vy * ny;
		if (rel < 0) {
			const out = Math.max(-rel * 0.55, 260);
			ball.vx += (out - rel) * nx;
			ball.vy += (out - rel) * ny;
			if (glider.cooldown <= 0) gliderHit();
		}
	}

	function updateSpinner(dt, prevY) {
		// Ball crossing the spinner line gives it a spin proportional to the ball's speed.
		if (ball.x > spinner.x1 && ball.x < spinner.x2 && (prevY - spinner.y) * (ball.y - spinner.y) < 0) {
			spinner.omega = Math.min(90, spinner.omega + Math.abs(ball.vy) * 0.035);
		}
	}

	function physicsStep(dt) {
		flippers.forEach(f => updateFlipper(f, dt));
		updateGlider(dt);
		if (ball.captured) return;

		const prevY = ball.y;
		ball.vy += GRAVITY * dt;
		const sp = Math.hypot(ball.vx, ball.vy);
		if (sp > MAX_SPEED) { ball.vx *= MAX_SPEED / sp; ball.vy *= MAX_SPEED / sp; }
		ball.x += ball.vx * dt;
		ball.y += ball.vy * dt;
		updateSpinner(dt, prevY);

		for (let i = 0; i < walls.length; i++) collideWall(walls[i]);
		for (let i = 0; i < bumpers.length; i++) collideBumper(bumpers[i]);
		collideFlipper(flipL);
		collideFlipper(flipR);
		collideGlider();
		checkSensors();

		// Safety net: if the ball ever escapes the cabinet, put it back in the lane.
		if (ball.x < 0 || ball.x > TW || ball.y < -40) resetBallToLane();
	}

	function checkSensors() {
		for (const s of sensors) {
			const d = Math.hypot(ball.x - s.x, ball.y - s.y);
			if (!s.inside && d < s.r) {
				s.inside = true;
				if (s.kind === 'lane') laneHit(s);
				if (s.kind === 'saucer') saucerHit(s);
				if (s.kind === 'inlane') inlaneHit(s);
			} else if (s.inside && d > s.r + 6) {
				s.inside = false;
			}
		}
	}

	// =====================================================================
	// Rules
	// =====================================================================

	function slingHit(w, impact, nx, ny) {
		if (impact < 60) return;
		ball.vx += nx * 560;
		ball.vy += ny * 560;
		w.flash = 0.12;
		addScore(500, (w.ax + w.bx) / 2, (w.ay + w.by) / 2);
		Sound.sling();
	}

	function gliderHit() {
		if (game.mode !== 'play') return;
		glider.cooldown = 0.4;
		glider.flash = 0.25;
		addScore(10000, glider.x, glider.y);
		game.bonus += 2000;
		Sound.glider();
		if (frenzy()) return;
		glider.hits++;
		if (glider.hits >= 3) {
			glider.hits = 0;
			game.frenzyUntil = game.time + 20;
			game.nextShot = game.time;
			backglass('GLIDER GUN!', 'DOUBLE SCORING FOR 20 SECONDS', 2.8, true);
			game.messageUntil = 0;                      // let the panel show the countdown
			Sound.frenzy();
			promote();
		} else {
			say(['GLIDER ' + glider.hits + ' / 3'], 1.8);
		}
	}

	// Career ladder: every completed feature promotes you through the CV, oldest role first.
	function promote() {
		const ladder = content.cvRoles.slice().reverse();
		if (!ladder.length) return;
		if (game.rank >= ladder.length) {
			addScore(100000, 182, 360);
			backglass('TOP OF THE LADDER', '+100,000', 2.5);
			return;
		}
		const role = ladder[game.rank];
		game.rank++;
		addScore(25000 * game.rank, 182, 360);
		backglass('PROMOTED!', role.title.toUpperCase() + '  ·  ' + role.org.toUpperCase(), 3.6);
		Sound.promote();
	}

	function inlaneHit(s) {
		if (game.mode !== 'play') return;
		s.flash = 0.4;
		addScore(1000, s.x, s.y);
		if (game.mult < 5) {
			game.mult++;
			say(['BONUS X' + game.mult], 1.8);
			Sound.mult();
		} else Sound.tick();
	}

	function spinnerTurn() {
		if (game.mode !== 'play') return;
		game.score += 100;
		game.bonus += 100;
		Sound.spin(spinner.omega);
	}

	function laneHit(s) {
		if (game.mode !== 'play') return;
		addScore(2500, s.x, s.y);
		game.bonus += 1000;
		if (game.time < game.skillUntil) {
			game.skillUntil = 0;
			if (s.index === game.skillLane) {
				addScore(50000, s.x, s.y + 20);
				Sound.fanfare();
				say(['SKILL SHOT!', '+50,000'], 2.5);
				game.shake = 4;
			}
		}
		if (!game.laneLit[s.index]) {
			game.laneLit[s.index] = true;
			Sound.lane();
			if (game.laneLit.every(Boolean)) {
				addScore(25000, 182, 120);
				Sound.jingle();
				say(['MUSIC LANES', 'COMPLETE!'], 3);
				showInfo('music');
				promote();
				setTimeout(() => { game.laneLit = [false, false, false]; }, 1200);
			}
		} else {
			Sound.tick();
		}
	}

	function cvHit(w) {
		if (game.mode !== 'play') return;
		const i = cvTargets.indexOf(w);
		w.flash = 0.15;
		addScore(5000, w.ax + 10, (w.ay + w.by) / 2);
		game.bonus += 1000;
		Sound.target();
		if (!game.cvLit[i]) {
			game.cvLit[i] = true;
			if (game.cvLit.every(Boolean)) {
				promote();
				setTimeout(() => { game.cvLit = [false, false]; }, 1200);
			}
		}
	}

	function dropHit(w) {
		if (game.mode !== 'play' || !w.active) return;
		w.active = false;
		addScore(5000, w.ax - 10, (w.ay + w.by) / 2);
		game.bonus += 1000;
		Sound.drop();
		if (dropTargets.every(t => !t.active)) {
			addScore(50000, 300, 350);
			Sound.fanfare();
			say(['E-L-I SPELLED!', '+50,000'], 3);
			showInfo('hello');
			promote();
			setTimeout(() => { dropTargets.forEach(t => { t.active = true; }); Sound.reset(); }, 1500);
		}
	}

	function saucerHit(s) {
		if (game.mode !== 'play') return;
		if (Math.hypot(ball.vx, ball.vy) > 1250) return;     // too fast: rattles over the hole
		ball.captured = true;
		ball.x = s.x; ball.y = s.y; ball.vx = ball.vy = 0;
		addScore(25000, s.x, s.y);
		game.bonus += 3000;
		Sound.saucer();
		showInfo('project');
		promote();
		// Hold the ball briefly, then kick it back into play (the info panel doesn't pause anything).
		setTimeout(() => {
			if (!ball.captured) return;
			ball.captured = false;
			ball.x = s.x + 4; ball.y = s.y - 4;
			ball.vx = 430; ball.vy = -560;
			s.inside = true;
			Sound.kick();
			game.shake = 3;
		}, 1300);
	}

	function resetBallToLane() {
		ball.x = 362; ball.y = 775; ball.vx = 0; ball.vy = 0; ball.captured = false;
		game.mode = game.mode === 'attract' ? 'attract' : 'lane';
	}

	function startGame() {
		Sound.unlock();
		game.score = 0; game.ballNum = 1; game.bonus = 0; game.mult = 1;
		game.rank = 0; game.frenzyUntil = 0; game.shots = []; glider.hits = 0;
		game.tiltMeter = 0; game.tilted = false;
		game.laneLit = [false, false, false]; game.cvLit = [false, false];
		dropTargets.forEach(t => { t.active = true; });
		game.startTime = game.time;
		game.mode = 'lane';
		resetBallToLane();
		game.mode = 'lane';
		game.glitch = 0.5;
		Sound.start();
		say(['BALL 1', LAUNCH_HINT + ' TO LAUNCH'], 3);
	}

	function launch() {
		if (game.mode !== 'lane' || !inLane()) return;
		const power = game.plungerPower;
		ball.vy = -(1350 + 1250 * power);
		ball.vx = 0;
		game.mode = 'play';
		game.saveUntil = game.time + 8;
		game.skillLane = Math.floor(Math.random() * 3);
		game.skillUntil = game.time + 6;
		say(['SKILL SHOT:', ['LEFT', 'MIDDLE', 'RIGHT'][game.skillLane] + ' LANE'], 3);
		Sound.launch(power);
	}

	function inLane() {
		return ball.x > 346 && ball.y > 730;
	}

	function drain() {
		if (game.time < game.saveUntil) {
			say(['BALL SAVED!'], 2);
			Sound.save();
			resetBallToLane();
			game.mode = 'lane';
			return;
		}
		game.mode = 'drained';
		ball.captured = true;                 // park the ball out of sight until the next one
		ball.vx = ball.vy = 0;
		ball.y = TL + 40;
		game.glitch = 0.9;
		game.shake = 4;
		Sound.drain();
		// End-of-ball bonus (lost if you tilted).
		const base = game.tilted ? 0 : game.bonus, mult = game.mult, bonus = base * mult;
		game.tilted = false; game.tiltMeter = 0;
		game.frenzyUntil = 0; game.shots = [];
		if (bonus > 0) {
			setTimeout(() => {
				game.score += bonus;
				say(['BONUS ' + base.toLocaleString('en-US') + ' X' + mult, '= ' + bonus.toLocaleString('en-US')], 2);
				Sound.bonus();
			}, 700);
		}
		game.bonus = 0;
		game.mult = 1;
		setTimeout(() => {
			if (game.ballNum >= game.balls) return gameOver();
			game.ballNum++;
			resetBallToLane();
			game.mode = 'lane';
			say(['BALL ' + game.ballNum], 2.5);
		}, bonus > 0 ? 2900 : 1600);
	}

	function gameOver() {
		game.mode = 'over';
		game.place = game.score > 0 ? saveScore(game.score) : 0;
		Sound.gameOver();
		say(['GAME OVER'], 3);
		backglass('GAME OVER', game.place ? 'NEW #' + game.place + ' SCORE!' : 'THANKS FOR PLAYING', 3, true);
		showInfo('over');
		setTimeout(() => {
			if (game.mode !== 'over') return;
			game.mode = 'attract';
			resetBallToLane();
			game.mode = 'attract';
		}, 3000);
	}

	// Nudge: bump the table. Too many in a row and you TILT (flippers die until the ball drains).
	function nudge() {
		if (game.mode !== 'play' || game.tilted || ball.captured) return;
		ball.vy -= 220;
		ball.vx += (Math.random() - 0.5) * 160;
		game.shake = 5;
		game.glitch = Math.max(game.glitch, 0.15);
		game.tiltMeter += 1;
		Sound.nudge();
		if (game.tiltMeter >= 3.5) {
			game.tilted = true;
			flipL.pressed = flipR.pressed = false;
			game.glitch = 1.4;
			backglass('TILT', 'FLIPPERS OFF UNTIL THE BALL DRAINS', 3, true);
			Sound.tilt();
		} else if (game.tiltMeter >= 2) {
			backglass('DANGER', 'EASY ON THE NUDGE', 1.4);
			Sound.danger();
		}
	}

	// =====================================================================
	// Site content for the cards (read from ../index.html)
	// =====================================================================

	const content = {
		name: 'Eli Arbogast',
		roles: ['Computer Science Student', 'Multi-instrumentalist + Producer'],
		tagline: 'I like making things!',
		projects: [],
		cvRoles: [], education: [], cvPage: '../#cv', pdf: '../cv/Eli_Arbogast_CV.pdf',
		music: { name: 'eLIVE', href: 'https://soundcloud.com/unelived' },
		email: 'self[at]eliarbogast[dot com]'
	};

	function absUrl(u) {
		if (!u) return null;
		if (/^(https?:|mailto:|#)/.test(u)) return u;
		return '../' + u.replace(/^\.\//, '');
	}

	function loadContent() {
		return fetch('../index.html', { cache: 'no-cache' })
			.then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })
			.then(html => {
				const doc = new DOMParser().parseFromString(html, 'text/html');
				const txt = (root, sel) => { const el = root.querySelector(sel); return el ? el.textContent.trim().replace(/\s+/g, ' ') : ''; };

				const name = txt(doc, '#home h1');
				if (name) content.name = name;
				const roles = Array.from(doc.querySelectorAll('#home .roles li')).map(li => li.textContent.trim());
				if (roles.length) content.roles = roles;
				content.tagline = txt(doc, '.tagline') || content.tagline;

				content.projects = Array.from(doc.querySelectorAll('#projects .project')).map(a => {
					const img = a.querySelector('img');
					return {
						title: txt(a, '.project-title'), tag: txt(a, '.project-tag'), desc: txt(a, '.project-desc'),
						href: absUrl(a.getAttribute('href')), img: img ? absUrl(img.getAttribute('src')) : null, alt: img ? img.getAttribute('alt') : ''
					};
				});

				content.cvRoles = Array.from(doc.querySelectorAll('#cv .cv-role')).map(r => {
					const h = r.querySelector('h3'), org = h && h.querySelector('.org');
					let title = '';
					if (h) h.childNodes.forEach(n => { if (n.nodeType === 3) title += n.textContent; });
					return { title: title.trim(), org: org ? org.textContent.trim() : '' };
				});

				const edu = doc.querySelector('#cv .cv-education p');
				if (edu) content.education = edu.innerHTML.split(/<br\s*\/?>/i).map(s => {
					const d = document.createElement('div'); d.innerHTML = s; return d.textContent.trim();
				}).filter(Boolean);

				const pdf = doc.querySelector('.cv-download');
				if (pdf) content.pdf = absUrl(pdf.getAttribute('href'));

				const sc = doc.querySelector('.sc-card');
				if (sc) content.music = { name: txt(sc, '.sc-name') || 'eLIVE', href: sc.getAttribute('href') };

				const email = txt(doc, '#contact .email');
				if (email) content.email = email;
			})
			.catch(() => { /* offline or opened from disk: keep the built-in fallbacks */ });
	}

	// =====================================================================
	// Info panel: small, non-blocking, sits over the score panel (the game keeps running)
	// =====================================================================

	const infoEl = document.getElementById('info');
	const infoTitle = document.getElementById('info-title');
	const infoBody = document.getElementById('info-body');
	let infoTime = 0, infoHover = false;

	function el(tag, text, cls) {
		const e = document.createElement(tag);
		if (text != null) e.textContent = text;
		if (cls) e.className = cls;
		return e;
	}

	function link(text, href) {
		const a = el('a', text);
		a.href = href;
		if (/^https?:/.test(href)) { a.target = '_blank'; a.rel = 'noopener'; }
		return a;
	}

	function showInfo(kind) {
		infoBody.textContent = '';

		if (kind === 'project') {
			const list = content.projects.length ? content.projects : [{ title: 'Projects', tag: 'eliarbogast.com', desc: 'See the Projects page on the main site.', href: '../#projects' }];
			const i = game.projectIndex % list.length, p = list[i];
			infoTitle.textContent = 'PROJECT ' + (i + 1) + '/' + list.length;
			infoBody.append(el('div', p.tag, 'tag'), el('h2', p.title), el('p', p.desc));
			if (p.href) { const pp = el('p'); pp.append(link('OPEN ↗', p.href)); infoBody.append(pp); }
			game.projectIndex++;
		}

		else if (kind === 'music') {
			infoTitle.textContent = 'MUSIC';
			infoBody.append(el('h2', content.music.name));
			const role = content.roles.find(r => /music|instrument|produc/i.test(r));
			if (role) infoBody.append(el('p', role));
			const pp = el('p'); pp.append(link('LISTEN ON SOUNDCLOUD ↗', content.music.href)); infoBody.append(pp);
		}

		else if (kind === 'hello') {
			infoTitle.textContent = 'HELLO';
			infoBody.append(el('h2', content.name.toUpperCase()));
			content.roles.forEach(r => infoBody.append(el('p', '> ' + r)));
		}

		else if (kind === 'over') {
			infoTitle.textContent = 'GAME OVER';
			infoBody.append(el('h2', game.score.toLocaleString('en-US')));
			if (game.place) infoBody.append(el('div', '#' + game.place + ' ON THIS MACHINE', 'tag'));
			infoBody.append(el('p', 'Thanks for playing! Say hi: ' + content.email));
		}

		infoEl.hidden = false;
		infoEl.classList.remove('in'); void infoEl.offsetWidth; infoEl.classList.add('in');
		infoTime = 9;
		Sound.card();
	}

	function hideInfo() { infoEl.hidden = true; }

	document.getElementById('info-x').addEventListener('click', hideInfo);
	infoEl.addEventListener('mouseenter', () => { infoHover = true; });
	infoEl.addEventListener('mouseleave', () => { infoHover = false; });

	// =====================================================================
	// Sound: tiny WebAudio synth (no samples)
	// =====================================================================

	const Sound = (function () {
		let ac = null, master = null;
		let muted = false;
		try { muted = localStorage.getItem('eli-pinball-mute') === '1'; } catch (e) {}

		function unlock() {
			if (!ac) {
				const AC = window.AudioContext || window.webkitAudioContext;
				if (!AC) return;
				ac = new AC();
				const lp = ac.createBiquadFilter();
				lp.type = 'lowpass'; lp.frequency.value = 5200;        // tape-ish top end
				master = ac.createGain();
				master.gain.value = muted ? 0 : 0.32;
				master.connect(lp); lp.connect(ac.destination);
			}
			if (ac.state === 'suspended') ac.resume();
		}

		function tone(freq, dur, type, vol, slideTo, delay) {
			if (!ac || muted) return;
			const t = ac.currentTime + (delay || 0);
			const o = ac.createOscillator(), g = ac.createGain();
			o.type = type || 'square';
			o.frequency.setValueAtTime(freq, t);
			if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
			g.gain.setValueAtTime(0.0001, t);
			g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.005);
			g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
			o.connect(g); g.connect(master);
			o.start(t); o.stop(t + dur + 0.02);
		}

		let noiseBuf = null;
		function noiseBuffer() {
			if (noiseBuf) return noiseBuf;
			noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
			const d = noiseBuf.getChannelData(0);
			for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
			return noiseBuf;
		}

		function noise(dur, vol, freq, delay, q) {
			if (!ac || muted) return;
			const t = ac.currentTime + (delay || 0);
			const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
			src.buffer = noiseBuffer();
			f.type = 'bandpass'; f.frequency.value = freq || 1500; f.Q.value = q || 1;
			g.gain.setValueAtTime(vol || 0.2, t);
			g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
			src.connect(f); f.connect(g); g.connect(master);
			src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
		}

		// Never let sound outlive the page: pause while the tab is hidden, shut down on leave.
		document.addEventListener('visibilitychange', () => {
			if (!ac) return;
			if (document.hidden) { if (ac.state === 'running') ac.suspend(); }
			else if (ac.state === 'suspended') ac.resume();
		});
		window.addEventListener('pagehide', () => {
			if (!ac) return;
			ac.close();
			ac = null; master = null; noiseBuf = null;   // a fresh context is made on the next key press / tap
		});

		function arp(notes, step, type, vol, len) {
			notes.forEach((n, i) => { if (n) tone(n, len || step * 1.1, type || 'square', vol || 0.15, null, i * step); });
		}

		function setMuted(m) {
			muted = m;
			try { localStorage.setItem('eli-pinball-mute', m ? '1' : '0'); } catch (e) {}
			if (master) master.gain.value = m ? 0 : 0.32;
		}

		return {
			unlock, setMuted, isMuted: () => muted,
			flipper: () => { noise(0.04, 0.22, 1800, 0, 2); tone(110, 0.05, 'triangle', 0.25, 60); },
			flipperDown: () => noise(0.03, 0.08, 900, 0, 2),
			bumper: () => { tone(740, 0.09, 'square', 0.16, 380); tone(1480, 0.05, 'triangle', 0.08); noise(0.03, 0.12, 3000); },
			sling: () => { noise(0.05, 0.25, 2200, 0, 3); tone(196, 0.07, 'square', 0.14, 98); },
			lane: () => arp([1568, 2093], 0.05, 'square', 0.1),
			tick: () => tone(2093, 0.03, 'triangle', 0.08),
			spin: w => tone(900 + Math.min(w, 90) * 14, 0.025, 'square', 0.05),
			glider: () => { arp([659, 988, 1319, 1976], 0.035, 'square', 0.12); noise(0.06, 0.15, 2500, 0, 2); },
			mult: () => arp([880, 1175, 1568], 0.045, 'triangle', 0.14),
			bonus: () => arp([523, 659, 784, 659, 784, 1047], 0.06, 'square', 0.1),
			target: () => { tone(1319, 0.06, 'square', 0.13); tone(1760, 0.09, 'square', 0.13, null, 0.06); },
			drop: () => { noise(0.06, 0.2, 700, 0, 2); tone(523, 0.08, 'square', 0.13, 262); },
			reset: () => { noise(0.08, 0.2, 500, 0, 2); arp([262, 330, 392], 0.04, 'triangle', 0.12); },
			saucer: () => arp([784, 659, 523, 392, 330], 0.06, 'square', 0.13),
			kick: () => { noise(0.1, 0.32, 500, 0, 1.5); tone(130, 0.12, 'square', 0.22, 55); },
			launch: p => { noise(0.25, 0.3, 600 + 900 * p, 0, 0.8); tone(90, 0.18, 'triangle', 0.25, 45); },
			plunger: p => tone(150 + 450 * p, 0.03, 'triangle', 0.05),
			drain: () => arp([392, 330, 262, 196, 147], 0.16, 'triangle', 0.2, 0.22),
			save: () => arp([523, 784, 1047], 0.07, 'square', 0.13),
			fanfare: () => arp([523, 659, 784, 1047, 784, 1047, 1319], 0.08, 'square', 0.12),
			start: () => arp([262, 392, 523, 659, 784, 1047], 0.07, 'square', 0.12),
			gameOver: () => arp([523, 494, 466, 440, 415, 392], 0.14, 'triangle', 0.2, 0.2),
			card: () => { noise(0.12, 0.08, 4000, 0, 0.5); tone(1047, 0.05, 'square', 0.08, null, 0.05); },
			promote: () => arp([392, 523, 659, 784, 1047], 0.07, 'square', 0.12),
			frenzy: () => { arp([523, 659, 784, 1047, 1319, 1568], 0.05, 'square', 0.12); noise(0.3, 0.15, 3000, 0, 1); },
			shot: () => tone(1800, 0.03, 'square', 0.04, 900),
			nudge: () => { noise(0.08, 0.3, 300, 0, 1); tone(70, 0.08, 'triangle', 0.3, 45); },
			danger: () => arp([880, 0, 880], 0.09, 'square', 0.12),
			tilt: () => { tone(220, 0.6, 'sawtooth', 0.15, 55); noise(0.5, 0.2, 800, 0, 0.5); },
			// Music lanes: a little tune instead of the generic fanfare.
			jingle: () => {
				[[659, 0], [784, 0.12], [988, 0.24], [880, 0.42], [784, 0.54], [659, 0.66], [784, 0.84], [988, 0.96]].forEach(([f, t]) => tone(f, 0.16, 'square', 0.11, null, t));
				[[165, 0], [196, 0.42], [247, 0.84]].forEach(([f, t]) => tone(f, 0.38, 'triangle', 0.16, null, t));
			},
			click: () => tone(1568, 0.03, 'square', 0.08)
		};
	})();

	// =====================================================================
	// Input
	// =====================================================================

	const canvas = document.getElementById('screen');
	canvas.tabIndex = 0;
	const keysDown = new Set();

	const LEFT_KEYS = ['KeyA', 'ArrowLeft'];
	const RIGHT_KEYS = ['KeyD', 'ArrowRight'];
	const LAUNCH_KEYS = ['Space', 'ArrowDown', 'Enter'];
	const NUDGE_KEYS = ['ShiftLeft', 'ShiftRight'];

	function setFlipper(f, down) {
		if (f.pressed === down) return;
		if (down && game.tilted) return;
		f.pressed = down;
		if (down) {
			Sound.flipper();
			// Lane change: flippers rotate the lit top lanes.
			if (game.mode === 'play' && game.laneLit.some(Boolean) && !game.laneLit.every(Boolean)) {
				const l = game.laneLit;
				game.laneLit = f === flipL ? [l[1], l[2], l[0]] : [l[2], l[0], l[1]];
			}
		} else {
			Sound.flipperDown();
		}
	}

	function startPlunger() {
		if (game.mode === 'lane' && inLane() && !game.plungerCharging) {
			game.plungerCharging = true;
			game.plungerPower = 0;
		}
	}

	function releasePlunger() {
		if (!game.plungerCharging) return;
		game.plungerCharging = false;
		launch();
		game.plungerPower = 0;
	}

	function releaseAllInput() {
		keysDown.clear();
		flipL.pressed = flipR.pressed = false;
		game.plungerCharging = false;
		game.plungerPower = 0;
		pointers.clear();
	}

	window.addEventListener('keydown', e => {
		if (e.code === 'Escape') hideInfo();
		if (e.target && e.target.closest && e.target.closest('a, button') && e.target !== canvas) {
			if (e.code === 'Space' || e.code === 'Enter') return;   // let links/buttons work
		}
		const code = e.code;
		if (LEFT_KEYS.includes(code) || RIGHT_KEYS.includes(code) || LAUNCH_KEYS.includes(code)) e.preventDefault();
		if (e.repeat) return;
		Sound.unlock();
		keysDown.add(code);

		if (code === 'KeyM') return toggleMute();
		if ((game.mode === 'attract' || game.mode === 'over') && LAUNCH_KEYS.includes(code)) return startGame();
		if (LEFT_KEYS.includes(code)) setFlipper(flipL, true);
		if (RIGHT_KEYS.includes(code)) setFlipper(flipR, true);
		if (LAUNCH_KEYS.includes(code)) startPlunger();
		if (NUDGE_KEYS.includes(code)) nudge();
	});

	window.addEventListener('keyup', e => {
		const code = e.code;
		keysDown.delete(code);
		if (LEFT_KEYS.includes(code) && !LEFT_KEYS.some(k => keysDown.has(k))) setFlipper(flipL, false);
		if (RIGHT_KEYS.includes(code) && !RIGHT_KEYS.some(k => keysDown.has(k))) setFlipper(flipR, false);
		if (LAUNCH_KEYS.includes(code)) releasePlunger();
	});

	window.addEventListener('blur', releaseAllInput);

	// Touch / mouse: left half = left flipper, right half = right flipper (+ plunger in the lane).
	const pointers = new Map();

	canvas.addEventListener('pointerdown', e => {
		e.preventDefault();
		Sound.unlock();
		canvas.focus({ preventScroll: true });
		if (game.mode === 'attract' || game.mode === 'over') { startGame(); return; }
		const rect = canvas.getBoundingClientRect();
		const right = (e.clientX - rect.left) > rect.width * (layout.portrait ? 0.5 : layout.view.w / layout.W * 0.5);
		pointers.set(e.pointerId, right ? 'R' : 'L');
		if (right) {
			if (game.mode === 'lane' && inLane()) startPlunger();
			else setFlipper(flipR, true);
		} else {
			setFlipper(flipL, true);
		}
		try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
	});

	function pointerEnd(e) {
		const side = pointers.get(e.pointerId);
		if (!side) return;
		pointers.delete(e.pointerId);
		const still = [...pointers.values()];
		if (side === 'L' && !still.includes('L')) setFlipper(flipL, false);
		if (side === 'R') {
			releasePlunger();
			if (!still.includes('R')) setFlipper(flipR, false);
		}
	}

	canvas.addEventListener('pointerup', pointerEnd);
	canvas.addEventListener('pointercancel', pointerEnd);
	canvas.addEventListener('contextmenu', e => e.preventDefault());

	const muteBtn = document.getElementById('mute');
	function toggleMute() {
		Sound.setMuted(!Sound.isMuted());
		muteBtn.textContent = 'Sound: ' + (Sound.isMuted() ? 'off' : 'on');
	}
	muteBtn.textContent = 'Sound: ' + (Sound.isMuted() ? 'off' : 'on');
	muteBtn.addEventListener('click', () => { Sound.unlock(); toggleMute(); });

	// =====================================================================
	// Layout + perspective projection
	// =====================================================================

	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	const layout = { W: 480, H: 360, portrait: false, view: null, panel: null };
	const proj = { cx: 0, hy: 0, K: 0, a: 0, F: 0, HK: 0.8, floorTop: 0, floorBot: 0, sFar: 0 };
	const FAR_RATIO = 0.5;         // far end of the table is drawn at 50% of the near end's width

	function computeLayout() {
		const portrait = window.innerHeight > window.innerWidth * 1.15;
		layout.portrait = portrait;
		if (portrait) {
			layout.W = 300; layout.H = 560;
			layout.panel = { x: 0, y: 0, w: 300, h: 74 };
			layout.view = { x: 0, y: 74, w: 300, h: 486 };
		} else {
			layout.W = 480; layout.H = 360;
			layout.view = { x: 0, y: 0, w: 300, h: 360 };
			layout.panel = { x: 300, y: 0, w: 180, h: 360 };
		}
		canvas.width = layout.W;
		canvas.height = layout.H;

		const v = layout.view;
		const sNear = (v.w - 6) / (TW + 56);             // fit table + cabinet rails
		const bottom = v.y + v.h - 5;
		const tilt = layout.portrait ? 0.78 : 0.5;            // smaller = more tilted (viewed from the front)
		const span = Math.min(v.h - 74, sNear * TL * tilt);
		const top = bottom - span;
		proj.F = sNear;
		proj.a = (1 / FAR_RATIO - 1) / TL;
		proj.K = span / (1 - FAR_RATIO);
		proj.hy = bottom - proj.K;
		proj.cx = v.x + v.w / 2;
		proj.floorTop = top;
		proj.floorBot = bottom;
		proj.sFar = sNear * FAR_RATIO;

		// Fit the low-res canvas to the window (soft upscale for the tape look).
		const scale = Math.min((window.innerWidth - 16) / layout.W, (window.innerHeight - 70) / layout.H);
		canvas.style.width = Math.floor(layout.W * scale) + 'px';
		canvas.style.height = Math.floor(layout.H * scale) + 'px';
		document.getElementById('crt').classList.toggle('portrait', portrait);
		infoEl.style.fontSize = Math.max(13, Math.round(layout.W * scale * (portrait ? 0.036 : 0.0165))) + 'px';
		buildPost();
	}

	// Table point (x, y) at height h → [screenX, screenY, horizontalScale, verticalScale]
	function P(x, y, h) {
		const z = 1 + (TL - y) * proj.a;
		const s = proj.F / z;
		return [proj.cx + (x - TW / 2) * s, proj.hy + proj.K / z - (h || 0) * s * proj.HK, s, proj.K * proj.a / (z * z)];
	}

	// =====================================================================
	// Playfield texture (drawn once, flat, then painted in perspective)
	// =====================================================================

	const tex = document.createElement('canvas'); tex.width = TW; tex.height = TL;
	const comp = document.createElement('canvas'); comp.width = TW; comp.height = TL;
	const tctx = tex.getContext('2d');
	const cctx = comp.getContext('2d');

	function buildTexture() {
		const g = tctx;
		g.clearRect(0, 0, TW, TL);

		// Base: deep violet night fading to near-black at the flippers.
		const bg = g.createLinearGradient(0, 0, 0, TL);
		bg.addColorStop(0, '#1d1030'); bg.addColorStop(0.55, '#140b20'); bg.addColorStop(1, '#09070d');
		g.fillStyle = bg; g.fillRect(0, 0, TW, TL);

		// Retro grid.
		g.strokeStyle = 'rgba(79,183,182,0.10)'; g.lineWidth = 1;
		for (let x = 20; x <= 380; x += 30) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, TL); g.stroke(); }
		for (let y = 0; y <= TL; y += 30) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(TW, y + 0.5); g.stroke(); }

		// Synthwave sun behind the title.
		const sx = 182, sy = 505, sr = 78;
		const sun = g.createLinearGradient(0, sy - sr, 0, sy + sr);
		sun.addColorStop(0, '#f2c27a'); sun.addColorStop(0.5, '#e8704f'); sun.addColorStop(1, '#a52f34');
		g.save();
		g.beginPath(); g.arc(sx, sy, sr, 0, Math.PI * 2); g.clip();
		g.fillStyle = sun; g.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
		g.fillStyle = '#140b20';
		for (let i = 0; i < 7; i++) { const yy = sy + 6 + i * 11; g.fillRect(sx - sr, yy, sr * 2, 2 + i * 1.2); }
		g.restore();
		g.globalAlpha = 0.35;
		g.strokeStyle = '#e8704f'; g.lineWidth = 2;
		g.beginPath(); g.arc(sx, sy, sr + 8, 0, Math.PI * 2); g.stroke();
		g.globalAlpha = 1;

		// Title.
		g.textAlign = 'center'; g.textBaseline = 'middle';
		g.font = '32px "Press Start 2P"';
		g.fillStyle = '#000'; g.fillText('ELI', sx + 4, 470 + 4);
		g.fillStyle = PAL.ink; g.fillText('ELI', sx, 470);

		// Game of Life gliders as decoration.
		function cells(ox, oy, pattern, size, color) {
			g.fillStyle = color;
			pattern.forEach(([cx, cy]) => g.fillRect(ox + cx * size, oy + cy * size, size - 1, size - 1));
		}
		const glider = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]];
		cells(255, 425, glider, 6, 'rgba(79,183,182,0.55)');
		cells(85, 560, glider.map(([x, y]) => [2 - x, y]), 6, 'rgba(232,112,79,0.5)');
		cells(268, 150, [[0, 0], [1, 0], [2, 0]], 5, 'rgba(79,183,182,0.4)');
		cells(60, 230, [[0, 0], [1, 0], [0, 1], [1, 1]], 6, 'rgba(232,112,79,0.4)');

		// Bumper footprints.
		bumpers.forEach(b => {
			g.fillStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); g.arc(b.x, b.y, b.r + 8, 0, Math.PI * 2); g.fill();
			g.strokeStyle = 'rgba(232,112,79,0.35)'; g.lineWidth = 2; g.beginPath(); g.arc(b.x, b.y, b.r + 8, 0, Math.PI * 2); g.stroke();
		});

		// Saucer hole + label.
		g.fillStyle = '#000'; g.beginPath(); g.arc(saucer.x, saucer.y, saucer.r + 3, 0, Math.PI * 2); g.fill();
		g.strokeStyle = PAL.chrome; g.lineWidth = 2; g.beginPath(); g.arc(saucer.x, saucer.y, saucer.r + 4, 0, Math.PI * 2); g.stroke();
		g.font = '8px "Press Start 2P"'; g.fillStyle = PAL.gold; g.textAlign = 'left';
		g.fillText('PROJECTS', 40, 372);

		// Lane labels.
		g.textAlign = 'center';
		g.font = '18px VT323'; g.fillStyle = 'rgba(242,237,228,0.6)';
		g.fillText('MUSIC LANES', 182.5, 140);

		// Plunger lane.
		g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(347, 255, 31, 545);
		g.save(); g.translate(368, 560); g.rotate(-Math.PI / 2);
		g.font = '16px VT323'; g.fillStyle = 'rgba(79,183,182,0.7)'; g.fillText('LAUNCH  >>>', 0, 0);
		g.restore();

		// Inlane arrows.
		g.fillStyle = 'rgba(79,183,182,0.35)';
		[[48, 640], [317, 640]].forEach(([x, y]) => { g.beginPath(); g.moveTo(x - 7, y); g.lineTo(x + 7, y); g.lineTo(x, y + 12); g.fill(); });

		// Orbit lane + spinner label.
		g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(24, 140, 53, 115);
		g.save(); g.translate(51, 238); g.rotate(-Math.PI / 2);
		g.font = '14px VT323'; g.fillStyle = 'rgba(242,194,122,0.75)'; g.textAlign = 'left'; g.textBaseline = 'middle';
		g.fillText('ORBIT >>', 0, 0);
		g.restore();

		// Bonus multiplier row label.
		g.font = '12px VT323'; g.fillStyle = 'rgba(242,237,228,0.45)'; g.textAlign = 'center'; g.textBaseline = 'middle';
		g.fillText('BONUS MULTIPLIER', 182.5, 626);

		// Glider track.
		g.strokeStyle = 'rgba(79,183,182,0.25)'; g.setLineDash([3, 4]); g.lineWidth = 1;
		g.beginPath(); g.moveTo(glider.minX - 8, glider.y + 0.5); g.lineTo(glider.maxX + 8, glider.y + 0.5); g.stroke();
		g.setLineDash([]);

		// Labels by the targets.
		g.font = '8px "Press Start 2P"'; g.fillStyle = PAL.teal; g.textAlign = 'left';
		g.fillText('CV', 42, 500);
		g.textAlign = 'right'; g.fillStyle = PAL.ember;
		g.fillText('SAY HI', 326, 420);

		// Apron: flipper key labels (lit while pressed, see drawLights) + name plate.
		g.fillStyle = '#05040a'; g.fillRect(0, 735, 345, 65);
		APRON_KEYS.forEach(k => keycap(g, k.x, k.y, 24, 20, k.label, false, 10));
		g.font = '16px "Press Start 2P"'; g.fillStyle = 'rgba(242,237,228,0.5)'; g.textAlign = 'center'; g.textBaseline = 'middle';
		g.fillText('ELI', 182.5, 766);
	}

	// Key labels on the apron (table units).
	const APRON_KEYS = [
		{ x: 92, y: 766, label: 'A', side: 'L' }, { x: 120, y: 766, label: '<', side: 'L' },
		{ x: 245, y: 766, label: '>', side: 'R' }, { x: 273, y: 766, label: 'D', side: 'R' }
	];

	// A little keyboard key. label '<' / '>' draws an arrow.
	function keycap(g, x, y, w, h, label, on, fontPx) {
		const x0 = x - w / 2, y0 = y - h / 2;
		g.fillStyle = on ? PAL.ember : '#2a2530';
		g.fillRect(x0, y0, w, h);
		g.fillStyle = on ? '#ffd9a8' : '#4b4450'; g.fillRect(x0, y0, w, 2); g.fillRect(x0, y0, 2, h);
		g.fillStyle = on ? '#8a2a20' : '#0d0b10'; g.fillRect(x0, y0 + h - 2, w, 2); g.fillRect(x0 + w - 2, y0, 2, h);
		const ink = on ? '#1a0d10' : '#e9e2ee';
		if (label === '<' || label === '>') {
			const a = fontPx * 0.45, dir = label === '<' ? -1 : 1;
			g.fillStyle = ink;
			g.beginPath();
			g.moveTo(x + dir * a, y); g.lineTo(x - dir * a * 0.6, y - a); g.lineTo(x - dir * a * 0.6, y + a);
			g.closePath(); g.fill();
		} else {
			g.font = fontPx + 'px "Press Start 2P"'; g.textAlign = 'center'; g.textBaseline = 'middle';
			g.fillStyle = ink; g.fillText(label, x + 0.5, y + 1);
		}
	}

	// Lights and other changing paint go on a copy of the texture each frame.
	function drawLights() {
		const g = cctx;
		g.drawImage(tex, 0, 0);
		const blink = Math.floor(game.time * 4) % 2 === 0;
		const slow = Math.floor(game.time * 2) % 2 === 0;

		function insert(x, y, r, on, color, label) {
			g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
			g.fillStyle = on ? color : 'rgba(255,255,255,0.07)'; g.fill();
			if (on) { g.globalAlpha = 0.35; g.beginPath(); g.arc(x, y, r + 5, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; }
			if (label) {
				g.font = '8px "Press Start 2P"'; g.textAlign = 'center'; g.textBaseline = 'middle';
				g.fillStyle = on ? '#1a0d10' : 'rgba(255,255,255,0.35)'; g.fillText(label, x, y + 1);
			}
		}

		// Music lanes (the skill-shot lane blinks teal right after launch).
		const skill = game.mode === 'play' && game.time < game.skillUntil;
		lanes.forEach((l, i) => {
			if (skill && i === game.skillLane) insert(l.x, 112, 7, Math.floor(game.time * 8) % 2 === 0, PAL.teal, '♪');
			else insert(l.x, 112, 7, game.laneLit[i] || (game.mode === 'attract' && (Math.floor(game.time * 3) % 3) === i), PAL.gold, '♪');
		});

		// Bonus multiplier inserts + inlane lights.
		[2, 3, 4, 5].forEach((m, i) => insert(148 + i * 23, 608, 8, game.mult >= m, PAL.gold, String(m)));
		inlanes.forEach(s => insert(s.x, s.y + 16, 5, s.flash > 0 || (game.mode === 'play' && game.mult < 5 && slow), PAL.teal, null));

		// Projects arrows (blink toward the saucer while playing).
		for (let i = 0; i < 3; i++) {
			const on = game.mode === 'attract' ? slow : (Math.floor(game.time * 6) % 3) === i;
			g.fillStyle = on ? PAL.gold : 'rgba(242,194,122,0.15)';
			const x = 110 - i * 13, y = 312 + i * 9;
			g.beginPath(); g.moveTo(x, y); g.lineTo(x - 10, y + 8); g.lineTo(x + 2, y + 10); g.fill();
		}

		// CV inserts.
		cvTargets.forEach((t, i) => insert(45, (t.ay + t.by) / 2, 7, game.cvLit[i] || t.flash > 0, PAL.teal, t.label));

		// E-L-I inserts.
		dropTargets.forEach(t => insert(312, (t.ay + t.by) / 2, 8, !t.active || (game.mode === 'attract' && slow), PAL.ember, t.label));

		// Ball save / shoot again.
		const saving = game.mode === 'play' && game.time < game.saveUntil;
		insert(182.5, 662, 9, saving && blink, PAL.teal, null);
		g.font = '13px VT323'; g.textAlign = 'center'; g.fillStyle = saving ? PAL.teal : 'rgba(79,183,182,0.3)';
		g.fillText('BALL SAVE', 182.5, 684);

		// Apron key labels light while their flipper is held.
		APRON_KEYS.forEach(k => {
			if ((k.side === 'L' ? flipL : flipR).pressed) keycap(g, k.x, k.y, 24, 20, k.label, true, 10);
		});

		// Bumper rings flash.
		bumpers.forEach(b => {
			if (b.flash > 0) { g.strokeStyle = PAL.gold; g.lineWidth = 3; g.beginPath(); g.arc(b.x, b.y, b.r + 8, 0, Math.PI * 2); g.stroke(); }
		});
	}

	// =====================================================================
	// Rendering
	// =====================================================================

	function poly(pts, fill, stroke, lw) {
		ctx.beginPath();
		ctx.moveTo(pts[0][0], pts[0][1]);
		for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
		ctx.closePath();
		if (fill) { ctx.fillStyle = fill; ctx.fill(); }
		if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
	}

	function drawFloor() {
		const v = layout.view;
		ctx.imageSmoothingEnabled = false;
		for (let r = Math.floor(proj.floorTop); r < proj.floorBot; r++) {
			const z = proj.K / (r + 0.5 - proj.hy);
			const y = TL - (z - 1) / proj.a;
			if (y < 0 || y >= TL) continue;
			const s = proj.F / z;
			ctx.drawImage(comp, 0, Math.floor(y), TW, 1, proj.cx - (TW / 2) * s, r, TW * s, 1);
		}
		ctx.imageSmoothingEnabled = true;
	}

	function drawCabinet() {
		const v = layout.view;
		// Backdrop.
		const bg = ctx.createLinearGradient(0, v.y, 0, v.y + v.h);
		bg.addColorStop(0, '#0b0910'); bg.addColorStop(1, '#030205');
		ctx.fillStyle = bg; ctx.fillRect(v.x, v.y, v.w, v.h);

		// Backbox standing at the far end.
		const topY = v.y + 6;
		const far = P(0, 0, 0);
		const bh = (far[1] - topY) / (far[2] * proj.HK);
		const b0 = P(-28, 0, 0), b1 = P(TW + 28, 0, 0), b2 = P(TW + 28, 0, bh), b3 = P(-28, 0, bh);
		const bb = ctx.createLinearGradient(0, b3[1], 0, b0[1]);
		bb.addColorStop(0, '#2a1636'); bb.addColorStop(1, '#120a19');
		poly([b0, b1, b2, b3], bb, '#4a3a55', 1);
		const midX = (b0[0] + b1[0]) / 2, midY = (b0[1] + b3[1]) / 2;
		const bw = b1[0] - b0[0];
		// Backglass art: title + a little sun.
		ctx.save();
		ctx.beginPath(); ctx.rect(b3[0] + 3, b3[1] + 3, bw - 6, b0[1] - b3[1] - 6); ctx.clip();
		const sun = ctx.createLinearGradient(0, midY - 30, 0, midY + 30);
		sun.addColorStop(0, PAL.gold); sun.addColorStop(1, PAL.emberDeep);
		ctx.globalAlpha = 0.85; ctx.fillStyle = sun;
		ctx.beginPath(); ctx.arc(midX, b0[1] + 6, (b0[1] - b3[1]) * 0.75, Math.PI, 0); ctx.fill();
		ctx.globalAlpha = 1;
		ctx.fillStyle = '#120a19';
		for (let i = 0; i < 5; i++) ctx.fillRect(b3[0], b0[1] - 4 - i * 6, bw, 1 + i * 0.5);
		if (marquee.cur) { drawMarquee(b0, b3, bw, midX, midY); ctx.restore(); drawRails(); return; }

		// Largest pixel-font size (multiple of 8) that fits the backglass.
		let fs = 32;
		ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
		while (fs > 8) {
			ctx.font = fs + 'px "Press Start 2P"';
			if (ctx.measureText('ELI').width < bw * 0.86 && fs < (b0[1] - b3[1]) * 0.4) break;
			fs -= 8;
		}
		ctx.font = fs + 'px "Press Start 2P"';
		const titleY = midY - Math.max(fs * 0.4, 7), subY = midY + Math.max(fs * 0.75, 10);
		ctx.fillStyle = '#000'; ctx.fillText('ELI', midX + 2, titleY + 2);
		const chrome = ctx.createLinearGradient(0, midY - fs, 0, midY);
		chrome.addColorStop(0, '#ffffff'); chrome.addColorStop(0.5, PAL.chrome); chrome.addColorStop(0.55, '#6d6474'); chrome.addColorStop(1, '#e9e2ee');
		ctx.fillStyle = chrome; ctx.fillText('ELI', midX, titleY);
		ctx.font = '16px VT323'; ctx.fillStyle = PAL.teal;
		ctx.fillText('· P I N B A L L ·', midX, subY);
		ctx.restore();
		drawRails();
	}

	function drawMarquee(b0, b3, bw, midX, midY) {
		const m = marquee.cur, hgt = b0[1] - b3[1];
		ctx.fillStyle = '#0a0610'; ctx.fillRect(b3[0], b3[1], bw, hgt);
		ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
		let fs = 24;
		while (fs > 8) { ctx.font = fs + 'px "Press Start 2P"'; if (ctx.measureText(m.title).width < bw * 0.9 && fs < hgt * 0.36) break; fs -= 8; }
		ctx.font = fs + 'px "Press Start 2P"';
		const on = m.t > 0.6 || Math.floor(m.t * 10) % 2 === 0;                 // blink in
		if (on) glowText(m.title, midX, midY - Math.max(fs * 0.45, 8), ctx.font, PAL.gold);
		if (m.sub) {
			ctx.font = '16px VT323';
			const w = ctx.measureText(m.sub).width;
			// Long lines scroll across like a real dot-matrix display.
			const x = w < bw * 0.92 ? midX : midX + bw / 2 + w / 2 - ((m.t * 70) % (bw + w));
			glowText(m.sub, x, midY + Math.max(fs * 0.7, 11), '16px VT323', PAL.teal);
		}
		// Dot-matrix grid over the glass.
		ctx.fillStyle = 'rgba(10,6,16,0.55)';
		for (let y = Math.floor(b3[1]); y < b0[1]; y += 2) ctx.fillRect(b3[0], y, bw, 1);
		for (let x = Math.floor(b3[0]); x < b3[0] + bw; x += 2) ctx.fillRect(x, b3[1], 1, hgt);
	}

	function drawRails() {
		// Side rails (wood + chrome cap).
		[[-28, 0], [TW, TW + 28]].forEach(([x0, x1]) => {
			const H = 30;
			const inner = x0 < 0 ? x1 : x0;
			poly([P(inner, 0, 0), P(inner, TL, 0), P(inner, TL, H), P(inner, 0, H)], '#1b1220');
			poly([P(x0, 0, H), P(x1, 0, H), P(x1, TL, H), P(x0, TL, H)], '#3a2418', '#7a5a44', 1);
			ctx.strokeStyle = '#d9d2dc'; ctx.lineWidth = 1;
			const a = P(inner, 0, H), b = P(inner, TL, H);
			ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
		});
	}

	function drawWall(w) {
		if (w.hidden || (w.kind === 'drop' && !w.active)) return;
		const H = w.h;
		const a0 = P(w.ax, w.ay, 0), b0 = P(w.bx, w.by, 0), a1 = P(w.ax, w.ay, H), b1 = P(w.bx, w.by, H);
		let side = '#24162e', top = '#b9b0c2';
		if (w.outer) { side = '#1b1220'; top = '#8f8597'; }
		if (w.kind === 'sling') { side = '#3a1418'; top = w.flash > 0 ? '#ffffff' : PAL.ember; }
		if (w.kind === 'standup') { side = '#0f3533'; top = w.flash > 0 ? '#ffffff' : PAL.teal; }
		if (w.kind === 'drop') { side = '#5a1c1c'; top = PAL.ember; }
		poly([a0, b0, b1, a1], side);
		ctx.strokeStyle = top;
		ctx.lineWidth = Math.max(1, w.r * 2 * a1[2]);
		ctx.lineCap = 'round';
		ctx.beginPath(); ctx.moveTo(a1[0], a1[1]); ctx.lineTo(b1[0], b1[1]); ctx.stroke();
		if (w.kind === 'drop' && w.label) {
			const m = P((w.ax + w.bx) / 2 - 4, (w.ay + w.by) / 2, H * 0.5);
			ctx.font = '8px "Press Start 2P"'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
			ctx.fillText(w.label, m[0], m[1]);
		}
	}

	function ellipse(x, y, rx, ry, fill, stroke, lw) {
		ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
		if (fill) { ctx.fillStyle = fill; ctx.fill(); }
		if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
	}

	function drawBumper(b) {
		const base = P(b.x, b.y, 0), top = P(b.x, b.y, b.h);
		const rx = b.r * base[2], ry = b.r * base[3];
		const lit = b.flash > 0;
		// Body.
		ellipse(base[0], base[1], rx, ry, '#1a0f14');
		ctx.fillStyle = lit ? '#ffd9a8' : '#7a2a25';
		ctx.fillRect(base[0] - rx, top[1], rx * 2, base[1] - top[1]);
		ctx.fillStyle = 'rgba(0,0,0,0.35)';
		ctx.fillRect(base[0] + rx * 0.35, top[1], rx * 0.65, base[1] - top[1]);
		// Cap.
		const capR = (b.r + 3) * top[2], capRy = (b.r + 3) * top[3];
		ellipse(top[0], top[1], capR, capRy, lit ? '#ffffff' : PAL.ember, '#2a0f10', 1);
		ellipse(top[0], top[1], capR * 0.62, capRy * 0.62, lit ? PAL.gold : '#f2a27a');
		ellipse(top[0], top[1] - capRy * 0.15, capR * 0.25, capRy * 0.22, lit ? '#fff' : PAL.ink);
	}

	function flipperOutline(f, h) {
		const pts = [];
		const ca = Math.cos(f.angle), sa = Math.sin(f.angle);
		const tx = f.x + ca * f.len, ty = f.y + sa * f.len;
		const N = 7;
		for (let i = 0; i <= N; i++) {               // tip half-circle
			const th = f.angle - Math.PI / 2 + (i / N) * Math.PI;
			pts.push(P(tx + Math.cos(th) * f.rTip, ty + Math.sin(th) * f.rTip, h));
		}
		for (let i = 0; i <= N; i++) {               // base half-circle
			const th = f.angle + Math.PI / 2 + (i / N) * Math.PI;
			pts.push(P(f.x + Math.cos(th) * f.rBase, f.y + Math.sin(th) * f.rBase, h));
		}
		return pts;
	}

	function drawFlipper(f) {
		poly(flipperOutline(f, 0), '#2a0f10');
		poly(flipperOutline(f, 4), '#7a2a25');
		poly(flipperOutline(f, 9), f.pressed ? '#fff3e6' : '#f2ede4', PAL.ember, 1.5);
		const pv = P(f.x, f.y, 9);
		ellipse(pv[0], pv[1], 2.5 * pv[2], 2.5 * pv[3], PAL.ember);
	}

	function drawSpinner() {
		const H = 16, axisH = 13;
		// Posts at each end.
		[spinner.x1 - 1, spinner.x2 + 1].forEach(x => {
			const b = P(x, spinner.y, 0), t = P(x, spinner.y, H + 4);
			ctx.fillStyle = '#6d6474'; ctx.fillRect(b[0] - 1.2, t[1], 2.4, b[1] - t[1]);
			ellipse(t[0], t[1], 2.4 * t[2], 2.4 * t[3], PAL.chrome);
		});
		// The plate rotates about the axis between the posts.
		const c = Math.cos(spinner.angle), sn = Math.sin(spinner.angle), half = 8;
		const yTop = spinner.y + sn * half, hTop = axisH + c * half;
		const yBot = spinner.y - sn * half, hBot = axisH - c * half;
		const q = [P(spinner.x1, yTop, hTop), P(spinner.x2, yTop, hTop), P(spinner.x2, yBot, hBot), P(spinner.x1, yBot, hBot)];
		poly(q, c > 0 ? '#e9e2ee' : '#8f8597', '#3a3340', 1);
		// Ember stripe so the spin reads clearly.
		const m1 = P(spinner.x1 + 4, spinner.y, axisH), m2 = P(spinner.x2 - 4, spinner.y, axisH);
		ctx.strokeStyle = PAL.ember; ctx.lineWidth = Math.max(1, Math.abs(c) * 2);
		ctx.beginPath(); ctx.moveTo(m1[0], m1[1]); ctx.lineTo(m2[0], m2[1]); ctx.stroke();
	}

	function drawGlider() {
		const shape = GLIDER_PHASES[glider.phase];
		const size = 9, lift = 12 + Math.sin(game.time * 3) * 2.5;
		const cx = shape.reduce((a, p) => a + p[0], 0) / shape.length, cy = shape.reduce((a, p) => a + p[1], 0) / shape.length;
		const lit = glider.flash > 0 || (frenzy() && Math.floor(game.time * 6) % 2 === 0);
		const sh = P(glider.x + 3, glider.y + 3, 0);
		ellipse(sh[0], sh[1], glider.r * sh[2], glider.r * sh[3] * 0.9, 'rgba(0,0,0,0.45)');
		// Cubes, back to front: front face then top face.
		shape.slice().sort((a, b) => a[1] - b[1]).forEach(([gx, gy]) => {
			const x0 = glider.x + (gx - cx) * size - size / 2, y0 = glider.y + (gy - cy) * size - size / 2;
			const x1 = x0 + size - 1, y1 = y0 + size - 1, h0 = lift, h1 = lift + size - 1;
			poly([P(x0, y1, h0), P(x1, y1, h0), P(x1, y1, h1), P(x0, y1, h1)], lit ? '#ffd9a8' : '#1f6f6a');
			poly([P(x0, y0, h1), P(x1, y0, h1), P(x1, y1, h1), P(x0, y1, h1)], lit ? '#ffffff' : PAL.teal, '#0b2f2d', 0.8);
		});
	}

	// Glider-gun shots: little gliders that skate down the table (purely visual).
	function drawShots() {
		game.shots.forEach(sh => {
			const c = P(sh.x, sh.y, 6);
			const sz = 3 * c[2];
			ctx.globalAlpha = Math.max(0, 1 - sh.t / 2.2);
			ctx.fillStyle = PAL.gold;
			GLIDER_PHASES[Math.floor(sh.t * 8) % 4].forEach(([gx, gy]) => ctx.fillRect(c[0] + (gx - 1.5) * sz, c[1] + (gy - 1.5) * sz, sz - 0.5, sz - 0.5));
		});
		ctx.globalAlpha = 1;
	}

	function drawPlunger() {
		const pull = game.plungerCharging ? game.plungerPower * 26 : 0;
		const y = 790 + pull;
		const a = P(362, y, 2), b = P(362, y, 14);
		ctx.fillStyle = '#6d6474'; ctx.fillRect(a[0] - 4 * a[2], b[1], 8 * a[2], 40 * a[2]);
		ellipse(b[0], b[1], 7 * b[2], 7 * b[3], PAL.chrome, '#3a3340', 1);
		if (game.plungerCharging) {
			// Power meter beside the lane.
			const m0 = P(392, 760, 30), m1 = P(392, 700, 30);
			const hgt = (m0[1] - m1[1]);
			ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(m0[0] - 3, m1[1], 6, hgt);
			ctx.fillStyle = game.plungerPower > 0.85 ? '#fff' : PAL.ember;
			ctx.fillRect(m0[0] - 3, m0[1] - hgt * game.plungerPower, 6, hgt * game.plungerPower);
		}
	}

	function drawBall() {
		if (ball.y > TL + 20) return;
		const sh = P(ball.x + 4, ball.y + 3, 0);
		ellipse(sh[0], sh[1], BALL_R * sh[2] * 1.1, BALL_R * sh[3] * 1.1, 'rgba(0,0,0,0.5)');
		const lift = ball.captured ? BALL_R * 0.3 : BALL_R;
		const c = P(ball.x, ball.y, lift);
		const r = BALL_R * c[2];
		const gr = ctx.createRadialGradient(c[0] - r * 0.35, c[1] - r * 0.4, r * 0.1, c[0], c[1], r);
		gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.35, '#d8d2de'); gr.addColorStop(0.8, '#6f6878'); gr.addColorStop(1, '#2a2530');
		ellipse(c[0], c[1], r, r, gr);
		// Warm reflection of the playfield lights.
		ellipse(c[0] + r * 0.25, c[1] + r * 0.45, r * 0.45, r * 0.18, 'rgba(232,112,79,0.45)');
	}

	function drawPopups(dt) {
		ctx.font = '8px "Press Start 2P"'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
		game.popups = game.popups.filter(p => (p.t += dt) < 0.8);
		game.popups.forEach(p => {
			const q = P(p.x, p.y, 20 + p.t * 60);
			ctx.globalAlpha = 1 - p.t / 0.8;
			ctx.fillStyle = '#000'; ctx.fillText(p.text, q[0] + 1, q[1] + 1);
			ctx.fillStyle = PAL.gold; ctx.fillText(p.text, q[0], q[1]);
		});
		ctx.globalAlpha = 1;
	}

	function drawScene(dt) {
		const v = layout.view;
		ctx.save();
		ctx.beginPath(); ctx.rect(v.x, v.y, v.w, v.h); ctx.clip();
		if (game.shake > 0) ctx.translate((Math.random() - 0.5) * game.shake, (Math.random() - 0.5) * game.shake);

		drawCabinet();
		drawLights();
		drawFloor();

		// Outer walls first, then everything else from back to front.
		walls.filter(w => w.outer).forEach(drawWall);
		const items = [];
		walls.forEach(w => { if (!w.outer) items.push({ y: Math.max(w.ay, w.by) - 2, draw: () => drawWall(w) }); });
		bumpers.forEach(b => items.push({ y: b.y, draw: () => drawBumper(b) }));
		flippers.forEach(f => items.push({ y: f.y + 6, draw: () => drawFlipper(f) }));
		items.push({ y: 790, draw: drawPlunger });
		items.push({ y: spinner.y + 8, draw: drawSpinner });
		items.push({ y: glider.y + 6, draw: drawGlider });
		items.push({ y: 700, draw: drawShots });
		if (game.mode !== 'attract' || inLane()) items.push({ y: ball.y, draw: drawBall });
		items.sort((a, b) => a.y - b.y).forEach(i => i.draw());

		drawPopups(dt);
		ctx.restore();
	}

	// ---------------------------------------------------------------- side panel

	function lcd(x, y, w, h) {
		ctx.fillStyle = '#050307'; ctx.fillRect(x, y, w, h);
		ctx.strokeStyle = '#000'; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
		ctx.strokeStyle = '#3a3340'; ctx.beginPath(); ctx.moveTo(x + 1, y + h - 0.5); ctx.lineTo(x + w - 0.5, y + h - 0.5); ctx.lineTo(x + w - 0.5, y + 1); ctx.stroke();
	}

	function glowText(text, x, y, font, color, glow) {
		ctx.font = font;
		ctx.shadowColor = glow || color; ctx.shadowBlur = 6;
		ctx.fillStyle = color; ctx.fillText(text, x, y);
		ctx.shadowBlur = 0;
	}

	// Remaining balls as dots (filled = still to play, including the current one).
	function ballDots(x, y, align) {
		const n = game.balls, gap = 12, w = (n - 1) * gap;
		const x0 = align === 'left' ? x + 4 : align === 'right' ? x - w - 4 : x - w / 2;
		for (let i = 0; i < n; i++) {
			const left = i < game.balls - game.ballNum + 1;
			ctx.beginPath(); ctx.arc(x0 + i * gap, y, 4, 0, Math.PI * 2);
			if (left) { ctx.fillStyle = PAL.chrome; ctx.fill(); }
			else { ctx.strokeStyle = '#4b4450'; ctx.lineWidth = 1; ctx.stroke(); }
		}
	}

	function drawPanel() {
		const p = layout.panel;
		const g = ctx.createLinearGradient(p.x, 0, p.x + p.w, 0);
		g.addColorStop(0, '#17121d'); g.addColorStop(1, '#0d0a11');
		ctx.fillStyle = g; ctx.fillRect(p.x, p.y, p.w, p.h);
		ctx.strokeStyle = '#4a3a55'; ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
		ctx.textBaseline = 'middle';

		const msg = game.time < game.messageUntil ? game.message : idleMessage();
		const scoreText = game.score.toLocaleString('en-US');
		const blinkOn = Math.floor(game.time * 2) % 2 === 0;
		const playing = game.mode !== 'attract';

		if (layout.portrait) {
			lcd(p.x + 6, p.y + 6, p.w - 12, p.h - 12);
			ctx.textAlign = 'left';
			glowText(scoreText, p.x + 14, p.y + 26, '16px "Press Start 2P"', PAL.ember);
			if (playing) ballDots(p.x + 10, p.y + 52, 'left');
			else { ctx.font = '16px VT323'; ctx.fillStyle = '#8d867c'; ctx.fillText('HIGH SCORE ' + game.hi.toLocaleString('en-US'), p.x + 14, p.y + 52); }
			ctx.textAlign = 'right';
			glowText(msg[0] || '', p.x + p.w - 14, p.y + 26, '18px VT323', PAL.teal);
			glowText(msg[1] || '', p.x + p.w - 14, p.y + 46, '18px VT323', PAL.teal);
			return;
		}

		const cx = p.x + p.w / 2;

		// Title.
		ctx.textAlign = 'center';
		ctx.font = '24px "Press Start 2P"'; ctx.fillStyle = '#000'; ctx.fillText('ELI', cx + 3, p.y + 37);
		const chrome = ctx.createLinearGradient(0, p.y + 22, 0, p.y + 46);
		chrome.addColorStop(0, '#fff'); chrome.addColorStop(0.5, PAL.chrome); chrome.addColorStop(0.55, '#6d6474'); chrome.addColorStop(1, '#efe8f2');
		ctx.fillStyle = chrome; ctx.fillText('ELI', cx, p.y + 34);
		ctx.font = '16px VT323'; ctx.fillStyle = PAL.teal; ctx.fillText('P I N B A L L', cx, p.y + 62);

		// Score display: big score, ball dots, messages.
		lcd(p.x + 10, p.y + 80, p.w - 20, 114);
		ctx.font = '16px "Press Start 2P"';
		const scoreFont = ctx.measureText(scoreText).width < p.w - 34 ? '16px "Press Start 2P"' : '8px "Press Start 2P"';
		glowText(scoreText, cx, p.y + 106, scoreFont, PAL.ember);
		if (playing) {
			ballDots(cx, p.y + 130, 'center');
			if (game.mult > 1) { ctx.textAlign = 'right'; glowText('X' + game.mult, p.x + p.w - 18, p.y + 130, '16px VT323', PAL.gold); ctx.textAlign = 'center'; }
		}
		if (msg[0]) glowText(msg[0], cx, p.y + 156, '18px VT323', PAL.teal);
		if (msg[1]) glowText(msg[1], cx, p.y + 174, '18px VT323', PAL.teal);
		if ((game.mode === 'attract' || game.mode === 'over') && !blinkOn) {
			ctx.fillStyle = '#050307'; ctx.fillRect(p.x + 12, p.y + 146, p.w - 24, 40);
		}

		// High score, or your current rank on the career ladder while playing.
		ctx.textAlign = 'center';
		if (playing && game.rank > 0) {
			const role = content.cvRoles[content.cvRoles.length - game.rank];
			let t = role ? role.title.toUpperCase() : '';
			ctx.font = '16px VT323';
			while (t.length > 4 && ctx.measureText(t).width > p.w - 20) t = t.slice(0, -2) + '…';
			ctx.fillStyle = '#6d6474'; ctx.fillText('RANK ' + game.rank + '/' + content.cvRoles.length, cx, p.y + 206);
			glowText(t, cx, p.y + 222, '16px VT323', PAL.gold);
		} else {
			ctx.font = '16px VT323'; ctx.fillStyle = '#8d867c';
			ctx.fillText('HIGH SCORE  ' + game.hi.toLocaleString('en-US'), cx, p.y + 212);
		}

		// Controls, drawn as keys (they light up while held).
		const L = flipL.pressed, R = flipR.pressed;
		keycap(ctx, p.x + 24, p.y + 250, 18, 16, 'A', L, 8);
		keycap(ctx, p.x + 46, p.y + 250, 18, 16, '<', L, 8);
		keycap(ctx, p.x + p.w - 46, p.y + 250, 18, 16, '>', R, 8);
		keycap(ctx, p.x + p.w - 24, p.y + 250, 18, 16, 'D', R, 8);
		ctx.font = '16px VT323'; ctx.fillStyle = '#c9c2cc'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
		ctx.fillText('FLIPPERS', cx, p.y + 250);

		const rows = [
			['SPACE', 56, 'LAUNCH', game.plungerCharging],
			['SHIFT', 56, game.tilted ? 'TILTED!' : 'NUDGE', game.tilted || keysDown.has('ShiftLeft') || keysDown.has('ShiftRight')],
			['M', 18, 'SOUND ' + (Sound.isMuted() ? 'OFF' : 'ON'), false]
		];
		rows.forEach(([key, w, label, on], i) => {
			const y = p.y + 278 + i * 26;
			keycap(ctx, p.x + 50, y, w, 16, key, on, 8);
			ctx.font = '16px VT323'; ctx.fillStyle = '#c9c2cc'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
			ctx.fillText(label, p.x + 88, y);
		});
	}

	// ---------------------------------------------------------------- VHS on-screen display

	function drawOSD() {
		const v = layout.view;
		ctx.textBaseline = 'top';
		ctx.font = '18px VT323';
		ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 1;
		ctx.fillStyle = '#f4f4f4';
		ctx.textAlign = 'left';
		if (game.mode === 'attract') { if (Math.floor(game.time * 1.5) % 2 === 0) ctx.fillText('PLAY ▶', v.x + 8, v.y + 6); }
		else ctx.fillText('PLAY ▶', v.x + 8, v.y + 6);
		ctx.textAlign = 'right';
		ctx.fillText('SP', v.x + v.w - 8, v.y + 6);

		const secs = game.mode === 'attract' ? 0 : Math.floor(game.time - game.startTime);
		const hh = Math.floor(secs / 3600), mm = Math.floor(secs / 60) % 60, ss = secs % 60;
		ctx.textAlign = 'left';
		ctx.fillText(hh + ':' + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0'), v.x + 8, v.y + v.h - 22);
		const d = new Date();
		const months = ['JAN.', 'FEB.', 'MAR.', 'APR.', 'MAY', 'JUN.', 'JUL.', 'AUG.', 'SEP.', 'OCT.', 'NOV.', 'DEC.'];
		ctx.textAlign = 'right';
		ctx.fillText(months[d.getMonth()] + ' ' + d.getDate() + ' ' + d.getFullYear(), v.x + v.w - 8, v.y + v.h - 22);
		ctx.shadowColor = 'transparent'; ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
		ctx.textBaseline = 'middle';
	}

	// ---------------------------------------------------------------- VHS post-processing

	let post = null;
	function buildPost() {
		const n = 1 << 16;
		const noise = new Int8Array(n);
		for (let i = 0; i < n; i++) noise[i] = (Math.random() * 2 - 1) * 9;
		post = { src: new Uint8ClampedArray(layout.W * layout.H * 4), noise, mask: n - 1 };
	}

	function vhsPass(dt) {
		const W = layout.W, H = layout.H;
		const img = ctx.getImageData(0, 0, W, H);
		const d = img.data, src = post.src;
		src.set(d);
		const noise = post.noise, mask = post.mask;
		let off = (Math.random() * 65536) | 0;

		const glitch = game.glitch;

		for (let y = 0; y < H; y++) {
			let shift = 0, extra = 0;
			if (y > H - 5) { shift = 3 + ((Math.random() * 4) | 0); extra = 20; }            // head-switching noise
			if (glitch > 0 && Math.random() < glitch * 0.25) shift += ((Math.random() * 12) | 0) - 6;
			const row = y * W;
			for (let x = 0; x < W; x++) {
				const i = (row + x) * 4;
				let xr = x + 1 + shift, xg = x + shift, xb = x - 1 + shift;
				if (xr < 0) xr = 0; else if (xr >= W) xr = W - 1;
				if (xg < 0) xg = 0; else if (xg >= W) xg = W - 1;
				if (xb < 0) xb = 0; else if (xb >= W) xb = W - 1;
				const n = noise[(off++) & mask] + (extra ? (Math.random() * extra) : 0);
				d[i] = src[(row + xr) * 4] + n;
				d[i + 1] = src[(row + xg) * 4 + 1] + n;
				d[i + 2] = src[(row + xb) * 4 + 2] + n;
			}
		}
		ctx.putImageData(img, 0, 0);
	}

	// =====================================================================
	// Main loop
	// =====================================================================

	let last = performance.now();
	let acc = 0;
	const perf = { draw: 0, vhs: 0 };

	function frame(now) {
		let dt = Math.min(0.05, (now - last) / 1000);
		last = now;
		game.time += dt;

		{
			// Plunger charge.
			if (game.plungerCharging) {
				const before = game.plungerPower;
				game.plungerPower = Math.min(1, game.plungerPower + dt * 1.1);
				if (Math.floor(before * 8) !== Math.floor(game.plungerPower * 8)) Sound.plunger(game.plungerPower);
			}

			acc += dt;
			while (acc >= STEP) { physicsStep(STEP); acc -= STEP; }

			// Timers.
			walls.forEach(w => { if (w.flash > 0) w.flash -= dt; });
			bumpers.forEach(b => { if (b.flash > 0) b.flash -= dt; });
			inlanes.forEach(s => { if (s.flash > 0) s.flash -= dt; });
			if (glider.flash > 0) glider.flash -= dt;
			glider.phase = Math.floor(game.time * 2.5) % 4;

			// Spinner: spin down, score every half turn.
			spinner.angle += spinner.omega * dt;
			spinner.omega *= Math.exp(-dt * 1.6);
			if (spinner.omega < 0.3) spinner.omega = 0;
			const half = Math.floor(spinner.angle / Math.PI);
			if (half !== spinner.halfTurns) { spinner.halfTurns = half; if (spinner.omega > 0) spinnerTurn(); }

			if (game.mode === 'play') {
				if (ball.y > TL + 12) drain();
				// Unstick a ball that has come to rest somewhere odd.
				const cradled = (flipL.pressed || flipR.pressed) && ball.y > 620;   // player is holding the ball on a flipper
				if (!ball.captured && !cradled && Math.hypot(ball.vx, ball.vy) < 25 && !inLane()) {
					game.stillTime += dt;
					if (game.stillTime > 2.5) { ball.vx = (Math.random() - 0.5) * 300; ball.vy = -250; game.stillTime = 0; game.shake = 3; }
				} else game.stillTime = 0;
			}
			if ((game.mode === 'lane' || game.mode === 'attract') && !inLane() && ball.y > TL + 12) resetBallToLane();

			// Tilt meter cools down; glider-gun shots; backglass messages; info panel timer.
			game.tiltMeter = Math.max(0, game.tiltMeter - dt * 0.6);
			if (frenzy() && game.time >= game.nextShot) {
				game.nextShot = game.time + 0.55;
				game.shots.push({ x: glider.x, y: glider.y + 10, vx: (Math.random() - 0.5) * 220, vy: 190 + Math.random() * 80, t: 0 });
				Sound.shot();
			}
			game.shots = game.shots.filter(sh => { sh.t += dt; sh.x += sh.vx * dt; sh.y += sh.vy * dt; return sh.t < 2.2; });
			if (!marquee.cur && marquee.queue.length) { marquee.cur = marquee.queue.shift(); marquee.cur.t = 0; }
			if (marquee.cur && (marquee.cur.t += dt) > marquee.cur.secs) marquee.cur = null;
			if (!infoEl.hidden && !infoHover && (infoTime -= dt) <= 0) hideInfo();
		}

		game.shake = Math.max(0, game.shake - dt * 12);
		game.glitch = Math.max(0, game.glitch - dt * 1.2);

		ctx.fillStyle = '#000';
		ctx.fillRect(0, 0, layout.W, layout.H);
		const t0 = performance.now();
		drawScene(dt);
		drawPanel();
		drawOSD();
		const t1 = performance.now();
		vhsPass(dt);
		perf.draw = perf.draw * 0.95 + (t1 - t0) * 0.05;
		perf.vhs = perf.vhs * 0.95 + (performance.now() - t1) * 0.05;

	}

	// Keep the loop alive even if a single frame throws.
	function loop(now) {
		try { frame(now); }
		catch (err) { if (window.console) console.error(err); }
		requestAnimationFrame(loop);
	}

	// =====================================================================
	// Boot
	// =====================================================================

	computeLayout();
	window.addEventListener('resize', computeLayout);

	const fontsReady = document.fonts && document.fonts.load
		? Promise.all([document.fonts.load('16px VT323'), document.fonts.load('8px "Press Start 2P"')]).catch(() => {})
		: Promise.resolve();

	Promise.all([fontsReady, loadContent()]).then(() => {
		buildTexture();
		requestAnimationFrame(t => { last = t; loop(t); });
		canvas.focus({ preventScroll: true });
	});

	// Small hook for automated tests / tinkering in the console.
	window.__pinball = {
		game, ball, flippers, walls, content, perf,
		start: startGame,
		launchWith: p => { game.plungerPower = p; launch(); },
		flip: (side, down) => setFlipper(side === 'L' ? flipL : flipR, down),
		nudge, promote, showInfo, hideInfo, glider, topScores: () => topScores
	};

})();
