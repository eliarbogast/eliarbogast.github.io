/*
	Panel navigation for eliarbogast.com
	Based on Astral by HTML5 UP (html5up.net | @ajlkn), CCA 3.0 license (html5up.net/license).
	Rewritten in plain JavaScript (no jQuery).
*/

(function () {
	'use strict';

	var body = document.body,
		main = document.getElementById('main'),
		panels = Array.prototype.filter.call(main.children, function (el) {
			return el.classList.contains('panel');
		}),
		navLinks = Array.prototype.slice.call(document.querySelectorAll('#nav a')),
		small = window.matchMedia('(max-width: 736px)'),
		pending = [];

	// Fade the page in once everything has loaded.
		window.addEventListener('load', function () {
			window.setTimeout(function () {
				body.classList.remove('is-preload');
			}, 100);
		});

	// Helpers.
		function panelFor(hash) {
			if (!hash || hash === '#') return null;
			var id = decodeURIComponent(hash.slice(1));
			for (var i = 0; i < panels.length; i++)
				if (panels[i].id === id) return panels[i];

			// An id inside a panel (e.g. #music, now part of Projects) opens that panel.
			var el = document.getElementById(id);
			while (el && el !== main) {
				if (panels.indexOf(el) !== -1) return el;
				el = el.parentElement;
			}
			return null;
		}

		function linkFor(panel) {
			for (var i = 0; i < navLinks.length; i++) {
				var href = navLinks[i].getAttribute('href');
				if (href === '#' + panel.id || (href === '#' && panel === panels[0])) return navLinks[i];
			}
			return null;
		}

		function setActiveLink(panel) {
			navLinks.forEach(function (a) {
				a.classList.remove('active');
				a.removeAttribute('aria-current');
			});
			var link = linkFor(panel);
			if (link) {
				link.classList.add('active');
				link.setAttribute('aria-current', 'page');
			}
		}

		// Replay the tagline colour sweep whenever its panel is shown.
		function replayTagline(panel) {
			Array.prototype.forEach.call(panel.querySelectorAll('.tagline'), function (el) {
				el.style.animation = 'none';
				void el.offsetWidth;
				el.style.animation = '';
			});
		}

		function later(fn, ms) {
			pending.push(window.setTimeout(fn, ms));
		}

		function cancelPending() {
			pending.forEach(window.clearTimeout);
			pending = [];
		}

	// Initial panel.
		(function () {
			var panel = panelFor(window.location.hash) || panels[0];

			panels.forEach(function (p) {
				if (p !== panel) {
					p.classList.add('inactive');
					p.style.display = 'none';
				}
			});

			setActiveLink(panel);
			window.scrollTo(0, 0);
		})();

	// Switch panels when the hash changes (nav icons, the photo arrow, the tagline...).
		window.addEventListener('hashchange', function () {
			var hash = window.location.hash,
				panel = panelFor(hash);

			// A hash that isn't a panel (e.g. a footnote): leave things alone.
				if (hash && hash !== '#' && !panel) return;

			panel = panel || panels[0];
			cancelPending();

			panels.forEach(function (p) { p.classList.add('inactive'); });
			setActiveLink(panel);

			// Lock the height so the swap animates smoothly.
				var h = main.offsetHeight;
				main.style.maxHeight = h + 'px';
				main.style.minHeight = h + 'px';

			later(function () {
				panels.forEach(function (p) { p.style.display = 'none'; });
				panel.style.display = '';
				replayTagline(panel);

				var target = panel.offsetHeight;
				main.style.maxHeight = target + 'px';
				main.style.minHeight = target + 'px';
				window.scrollTo(0, 0);

				later(function () {
					panel.classList.remove('inactive');
					main.style.maxHeight = '';
					main.style.minHeight = '';
				}, small.matches ? 0 : 500);
			}, 250);
		});

})();
