<script>
	import { onMount } from 'svelte';
	import { flip } from 'svelte/animate';
	import { scale, fade } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import Papa from 'papaparse';
	import uFuzzy from '@leeoniya/ufuzzy';

	// Base-aware so it resolves under the GitHub Pages base ('/stars/data/stars.csv')
	// and at root in flat dev. BASE_URL is '/stars' (no trailing slash) on Pages, '/' in dev.
	const DATA_URL = import.meta.env.BASE_URL.replace(/\/$/, '') + '/data/stars.csv';

	// Fuzzy/keyword search over name + description. `intraMode: 1` allows one typo
	// per term (substitution/transposition/insertion/deletion); search() with
	// outOfOrder lets terms match in any order ("react state" hits "state … React").
	const uf = new uFuzzy({ intraMode: 1, intraIns: 1 });

	// `limit` is the collapsed row count; `expandMax` caps how many a "Show all"
	// toggle reveals (so a long-tail facet like topics can't render thousands).
	const FACETS = [
		{ column: 'language', type: 'set', label: 'Language', limit: 12, expandMax: 80 },
		{ column: 'topics', type: 'set', label: 'Topics', limit: 15, multi: true, expandMax: 120 },
		{ column: 'license_name', type: 'set', label: 'License', limit: 8, expandMax: 60 },
		{ column: 'stargazers_count', type: 'range', label: 'Stars' },
		{ column: 'fork', type: 'set', label: 'Fork', boolean: true },
		{ column: 'archived', type: 'set', label: 'Archived', boolean: true },
	];

	const SORT_OPTIONS = [
		{ key: 'stargazers_count', label: 'Stars' },
		{ key: 'starred_at', label: 'Starred' },
		{ key: 'updated_at', label: 'Updated' },
		{ key: 'created_at', label: 'Created' },
		{ key: 'full_name', label: 'Name' },
	];

	const NUMERIC_COLS = new Set(['stargazers_count', 'forks_count', 'open_issues_count']);
	const BOOLEAN_COLS = new Set(['fork', 'archived']);
	const RENDER_LIMIT = 100; // cap rendered cards so FLIP animation stays smooth
	const CARD_TOPICS = 3; // topic chips shown per card before the "+N" overflow

	// Linguist language colors (verbatim from Orbit's lib/languages.ts, which is
	// the canonical GitHub palette). Unmapped languages fall back to the accent.
	const LANG_COLORS = {
		TypeScript: '#3178c6', JavaScript: '#f1e05a', Python: '#3572A5', Rust: '#dea584',
		Go: '#00ADD8', Java: '#b07219', 'C++': '#f34b7d', C: '#555555', 'C#': '#178600',
		Ruby: '#701516', Swift: '#F05138', Kotlin: '#A97BFF', Dart: '#00B4AB', PHP: '#4F5D95',
		Scala: '#c22d40', Shell: '#89e051', Lua: '#000080', Haskell: '#5e5086', Elixir: '#6e4a7e',
		Clojure: '#db5855', Erlang: '#B83998', R: '#198CE7', Julia: '#a270ba', Perl: '#0298c3',
		'Objective-C': '#438eff', Vue: '#41b883', Svelte: '#ff3e00', HTML: '#e34c26', CSS: '#563d7c',
		SCSS: '#c6538c', Zig: '#ec915c', Nim: '#ffc200', OCaml: '#3be133', 'F#': '#b845fc',
		Nix: '#7e7eff', Dockerfile: '#384d54', Makefile: '#427819', VimScript: '#199f4b',
		'Emacs Lisp': '#c065db', TeX: '#3D6117', Markdown: '#083fa1',
	};
	const langColor = (l) => LANG_COLORS[l] ?? 'var(--accent)';

	// Topics have no canonical colors, so hash each label to a stable hue.
	// Same algorithm Orbit uses for its category dots (lib/utils.ts stringToColor).
	function topicColor(str) {
		let hash = 0;
		for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
		return `hsl(${((hash % 360) + 360) % 360}, 55%, 55%)`;
	}

	const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

	// Compact star count: 3621 → "3.6k", 12000 → "12k".
	function formatStars(n) {
		if (n == null) return '0';
		if (n < 1000) return String(n);
		const k = n / 1000;
		return (k < 10 ? k.toFixed(1).replace(/\.0$/, '') : Math.round(k)) + 'k';
	}

	// "2026-04-12T…" → "Apr 2026".
	function formatDate(s) {
		if (!s) return '';
		const d = new Date(s);
		if (isNaN(d)) return '';
		return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
	}

	function topicsOf(row) {
		return row.topics ? row.topics.split(',').map((t) => t.trim()).filter(Boolean) : [];
	}

	function ownerOf(row) {
		return row.owner_name || (row.full_name ?? '').split('/')[0] || '';
	}
	function repoOf(row) {
		const i = (row.full_name ?? '').indexOf('/');
		return i === -1 ? row.full_name : row.full_name.slice(i + 1);
	}
	function ownerUrl(row) {
		return `https://github.com/${ownerOf(row)}`;
	}
	// Keep an inner click (owner link, repo link) from also opening the modal.
	function stopEvt(e) {
		e.stopPropagation();
	}
	// Open the modal from keyboard when the card itself has focus.
	function cardKey(row, e) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			selected = row;
			updateURL();
		}
	}

	// `initial` is the build-time prerendered first page (see lib/prerender.ts).
	// Astro's SSR pass renders it as the island fallback; the component shows it
	// until its own CSV load finishes on the client, then `rows` takes over.
	let { initial = null } = $props();

	// ---- Reactive state (Svelte 5 runes) --------------------------------------
	let rows = $state([]);
	let filters = $state([]);
	let searchQuery = $state(''); // applied (debounced) query that drives filtering
	let searchField = $state(''); // live input value (updates every keystroke)
	let searchDebounce; // timer that defers searchQuery behind typing
	let sortKey = $state('starred_at');
	let sortDir = $state('desc');
	let loading = $state(!initial);
	let status = $state(initial?.status ?? '');
	let loadedCount = $state(0);
	let searchInput = $state(null);
	let selected = $state(null); // repo shown in the detail modal
	let dialogEl = $state(null);
	let expanded = $state({}); // facet column → showing all rows?
	let reducedMotion = $state(false); // set from matchMedia on mount

	// README rendered in the modal. Fetched on demand from a CDN (no GitHub API
	// rate limit), rendered + sanitized client-side, and memoized per repo.
	let readmeHtml = $state('');
	let readmeState = $state('idle'); // idle | loading | loaded | empty | error
	const readmeCache = new Map();
	const readmeInFlight = new Map(); // repo → in-flight build promise (dedupes)
	let mermaidId = 0; // unique ids for mermaid.render()
	let hoverTimer; // intent delay before a hover prefetch fires

	function mapRow(o) {
		const obj = {};
		for (const h in o) {
			let v = o[h];
			if (v === '' || v == null) v = null;
			else if (NUMERIC_COLS.has(h)) v = Number(v);
			else if (BOOLEAN_COLS.has(h)) v = v === 'true' || v === true;
			obj[h] = v;
		}
		obj._search = `${obj.full_name} ${obj.description || ''}`.toLowerCase();
		return obj;
	}

	function getFilter(column) {
		return filters.find((f) => f.column === column);
	}

	function applyFilters(rowsArr, excludeColumn) {
		const activeFilters = filters.filter((f) => f.column !== excludeColumn);
		return rowsArr.filter((r) => {
			if (searchMatchSet && !searchMatchSet.has(r)) return false;
			for (const f of activeFilters) {
				if (f.type === 'set') {
					if (f.column === 'topics') {
						const topicList = r.topics ? r.topics.split(',').map((t) => t.trim()) : [];
						const matches = f.values.some((v) =>
							v === '__null__' ? !r.topics : topicList.includes(v)
						);
						if (!matches) return false;
					} else {
						const val = r[f.column];
						const matches = f.values.some((v) => {
							if (v === '__null__') return val === null || val === undefined;
							if (BOOLEAN_COLS.has(f.column)) return String(val) === v;
							return String(val) === v;
						});
						if (!matches) return false;
					}
				} else if (f.type === 'range') {
					const val = r[f.column];
					if (f.min !== null && val < f.min) return false;
					if (f.max !== null && val > f.max) return false;
				}
			}
			return true;
		});
	}

	function computeFacetCounts(facet, filtered) {
		const counts = new Map();
		for (const r of filtered) {
			if (facet.multi) {
				if (!r.topics) {
					counts.set('__null__', (counts.get('__null__') ?? 0) + 1);
				} else {
					const seen = new Set();
					for (const t of r.topics.split(',')) {
						const trimmed = t.trim();
						if (trimmed && !seen.has(trimmed)) {
							seen.add(trimmed);
							counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
						}
					}
				}
			} else {
				const val = r[facet.column];
				const key = val === null || val === undefined ? '__null__' : String(val);
				counts.set(key, (counts.get(key) ?? 0) + 1);
			}
		}
		let arr = [...counts.entries()].map(([value, cnt]) => ({ value, cnt }));
		arr.sort((a, b) => b.cnt - a.cnt);
		// Cap to expandMax (the "Show all" ceiling); the template slices again to
		// `facet.limit` when collapsed. Avoids rendering a thousands-long tail.
		const cap = facet.expandMax ?? facet.limit;
		if (cap) arr = arr.slice(0, cap);
		return arr;
	}

	function computeRange(filtered) {
		const vals = filtered.map((r) => r.stargazers_count).filter((v) => v != null);
		if (!vals.length) return null;
		vals.sort((a, b) => a - b);
		return { min: vals[0], max: vals[vals.length - 1], med: vals[Math.floor(vals.length / 2)] };
	}

	function sortRows(data) {
		const mult = sortDir === 'desc' ? -1 : 1;
		return [...data].sort((a, b) => {
			const va = a[sortKey];
			const vb = b[sortKey];
			if (va == null && vb == null) return 0;
			if (va == null) return 1;
			if (vb == null) return -1;
			if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mult;
			return String(va).localeCompare(String(vb)) * mult;
		});
	}

	// ---- Derived values --------------------------------------------------------
	// Until the client CSV load populates `rows`, fall back to the prerendered
	// `initial` view so the SSR/first-paint shows the real first page.
	const hasData = $derived(rows.length > 0);

	// Per-row haystack ("full_name description", lowercased) — rebuilt only when the
	// row set changes, not per keystroke.
	const haystack = $derived(rows.map((r) => r._search));

	// Run the fuzzy search once per applied query and cache the matching rows in a
	// Set. applyFilters() runs many times (once per facet), so membership lookup
	// must be O(1) — re-running uFuzzy each call would scan 7.7k rows N times.
	// `null` means "no query" → search imposes no constraint.
	const searchMatchSet = $derived.by(() => {
		const q = searchQuery.trim();
		if (!q || !hasData) return null;
		const [idxs] = uf.search(haystack, q, 1); // outOfOrder=1 → keyword matching
		return new Set((idxs ?? []).map((i) => rows[i]));
	});

	const filteredRows = $derived(hasData ? sortRows(applyFilters(rows)) : []);
	const selectedIdx = $derived(selected && filteredRows.length ? filteredRows.findIndex(r => r === selected) : -1);
	const visibleRows = $derived(
		hasData ? filteredRows.slice(0, RENDER_LIMIT) : (initial?.visibleRows ?? [])
	);
	const displayCount = $derived(hasData ? filteredRows.length : (initial?.resultCount ?? 0));
	const facetData = $derived(
		hasData
			? FACETS.map((facet) => {
					if (facet.type === 'range') {
						return { facet, range: computeRange(applyFilters(rows)) };
					}
					return { facet, counts: computeFacetCounts(facet, applyFilters(rows, facet.column)) };
				})
			: (initial?.facetData ?? [])
	);

	// ---- Mutations -------------------------------------------------------------
	function toggleFilter(column, value) {
		const existing = getFilter(column);
		if (existing) {
			if (existing.values.includes(value)) {
				existing.values = existing.values.filter((v) => v !== value);
				if (existing.values.length === 0) {
					filters = filters.filter((f) => f.column !== column);
				} else {
					filters = [...filters];
				}
			} else {
				existing.values = [...existing.values, value];
				filters = [...filters];
			}
		} else {
			filters = [...filters, { column, type: 'set', values: [value] }];
		}
		updateURL();
	}

	function setRangeFilter(column, min, max) {
		const existing = getFilter(column);
		if (min === null && max === null) {
			filters = filters.filter((f) => f.column !== column);
		} else if (existing) {
			existing.min = min;
			existing.max = max;
			filters = [...filters];
		} else {
			filters = [...filters, { column, type: 'range', min, max }];
		}
		updateURL();
	}

	function isChecked(column, value) {
		const f = getFilter(column);
		return f && f.type === 'set' ? f.values.includes(value) : false;
	}

	// Debounce filtering so each keystroke doesn't re-scan 7.7k rows + facets.
	// The field updates instantly; the applied query lags ~180ms behind typing.
	function onSearchInput() {
		clearTimeout(searchDebounce);
		searchDebounce = setTimeout(() => {
			searchQuery = searchField;
			updateURL();
		}, 180);
	}

	function clearAll() {
		filters = [];
		searchField = '';
		searchQuery = '';
		clearTimeout(searchDebounce);
		updateURL();
	}

	function toggleExpand(column) {
		expanded = { ...expanded, [column]: !expanded[column] };
	}

	// Open the detail modal — but let modified/middle clicks open GitHub natively.
	function openCard(row, e) {
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;
		e.preventDefault();
		selected = row;
		updateURL();
	}

	function closeModal() {
		selected = null;
		updateURL();
	}

	function navigate(dir) {
		if (selectedIdx === -1) return;
		const next = filteredRows[selectedIdx + dir];
		if (next) { selected = next; updateURL(); }
	}

	// ---- README on demand ------------------------------------------------------
	// Try jsDelivr (resolves default branch, CDN-cached, CORS-ok, no rate limit),
	// then raw.githubusercontent as a fallback. Return null when none resolve.
	async function fetchReadme(fullName) {
		const urls = [
			`https://cdn.jsdelivr.net/gh/${fullName}/README.md`,
			`https://cdn.jsdelivr.net/gh/${fullName}/readme.md`,
			`https://raw.githubusercontent.com/${fullName}/HEAD/README.md`,
		];
		for (const url of urls) {
			try {
				const res = await fetch(url);
				if (res.ok) return await res.text();
			} catch {
				/* try next */
			}
		}
		return null;
	}

	// Phase 1 — the fast part: GFM → highlighted, sanitized HTML with relative
	// URLs absolutized. ```mermaid fences become lightweight placeholders so the
	// text can paint immediately; their sources are returned for phase 2.
	async function renderBase(md, fullName) {
		const [{ Marked }, { markedHighlight }, hljsMod, DOMPurify] = await Promise.all([
			import('marked'),
			import('marked-highlight'),
			import('highlight.js/lib/common'),
			import('dompurify'),
		]);
		const hljs = hljsMod.default;
		const purify = DOMPurify.default;

		const imgBase = `https://raw.githubusercontent.com/${fullName}/HEAD/`;
		const linkBase = `https://github.com/${fullName}/blob/HEAD/`;

		function rewriteImgSrc(src) {
			try {
				let out = new URL(src, imgBase).href;
				// github.com/blob/ serves HTML viewer, not raw bytes.
				out = out.replace(
					/^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\//,
					'https://raw.githubusercontent.com/$1/'
				);
				// raw.githubusercontent.com sends SVGs as text/plain + nosniff;
				// browsers refuse to render them in <img>. jsdelivr sends image/svg+xml.
				out = out.replace(
					/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.*)/,
					'https://cdn.jsdelivr.net/gh/$1/$2@$3/$4'
				);
				return out;
			} catch {
				return src;
			}
		}

		// Pre-process the raw markdown before marked/DOMPurify can touch it.
		// Absolutize all image URL attributes so DOMPurify never sees a relative
		// path that it would resolve against the page origin.
		const processedMd = md
			// markdown image syntax: ![alt](url)
			.replace(/!\[([^\]]*)\]\(([^)\s]+)([^)]*)\)/g, (_, alt, href, rest) =>
				`![${alt}](${rewriteImgSrc(href)}${rest})`
			)
			// <img src="..."> and <source srcset="..."> HTML tags
			.replace(/(<(?:img|source)\s[^>]*?\bsrc=")([^"]+)(")/gi, (_, pre, href, post) =>
				`${pre}${rewriteImgSrc(href)}${post}`
			)
			.replace(/(<source\s[^>]*?\bsrcset=")([^"]+)(")/gi, (_, pre, href, post) =>
				`${pre}${rewriteImgSrc(href.trim())}${post}`
			);

		const marked = new Marked(
			markedHighlight({
				langPrefix: 'hljs language-',
				highlight(code, lang) {
					if (lang === 'mermaid') return escapeHtml(code); // rendered in phase 2
					const language = hljs.getLanguage(lang) ? lang : 'plaintext';
					return hljs.highlight(code, { language }).value;
				},
			})
		);
		const dirty = marked.parse(processedMd, { gfm: true, async: false });
		const clean = purify.sanitize(typeof dirty === 'string' ? dirty : '', {
			ADD_TAGS: ['picture', 'source'],
			ADD_ATTR: ['srcset', 'media'],
		});

		const tpl = document.createElement('template');
		tpl.innerHTML = clean;
		for (const img of tpl.content.querySelectorAll('img[src]')) {
			img.setAttribute('loading', 'lazy');
		}
		for (const a of tpl.content.querySelectorAll('a[href]')) {
			const href = a.getAttribute('href');
			if (href && !href.startsWith('#')) {
				try {
					a.setAttribute('href', new URL(href, linkBase).href);
				} catch {
					/* leave as-is */
				}
			}
			a.setAttribute('target', '_blank');
			a.setAttribute('rel', 'noopener noreferrer');
		}

		// Swap mermaid code blocks for placeholders; collect their sources.
		const mermaids = [];
		for (const codeEl of tpl.content.querySelectorAll('code.language-mermaid')) {
			const host = codeEl.closest('pre') || codeEl;
			const ph = document.createElement('div');
			ph.className = 'mermaid-pending';
			ph.setAttribute('data-mmd', String(mermaids.length));
			ph.textContent = 'Rendering diagram…';
			host.replaceWith(ph);
			mermaids.push(codeEl.textContent || '');
		}
		return { html: tpl.innerHTML, mermaids };
	}

	// Phase 2 — the slow part: render each mermaid source to SVG and patch it into
	// the base html. mermaid (large) loads only here, only when diagrams exist.
	async function enhanceMermaid(baseHtml, mermaids) {
		if (!mermaids.length) return baseHtml;
		const mermaid = (await import('mermaid')).default;
		const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
		mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' });

		const tpl = document.createElement('template');
		tpl.innerHTML = baseHtml;
		for (let i = 0; i < mermaids.length; i++) {
			const ph = tpl.content.querySelector(`[data-mmd="${i}"]`);
			if (!ph) continue;
			try {
				// strict mode sanitizes mermaid's own output (foreignObject labels) —
				// a second svg-profile DOMPurify pass would strip those labels.
				const { svg } = await mermaid.render(`mmd-${mermaidId++}`, mermaids[i]);
				const wrap = document.createElement('div');
				wrap.className = 'mermaid-rendered';
				wrap.innerHTML = svg;
				ph.replaceWith(wrap);
			} catch {
				ph.textContent = 'Could not render diagram.';
			}
		}
		return tpl.innerHTML;
	}

	// Build a README in two exposed stages so a viewer can paint the text the
	// moment phase 1 is done, even while phase 2 (mermaid) is still running — and
	// so a hover prefetch and the click that follows share the same work.
	// Returns { base, final }: base resolves after renderBase, final after mermaid.
	function buildReadme(key) {
		if (readmeInFlight.has(key)) return readmeInFlight.get(key);
		if (readmeCache.has(key)) {
			const done = Promise.resolve(readmeCache.get(key));
			return { base: done, final: done };
		}
		let resolveBase, rejectBase;
		const base = new Promise((res, rej) => {
			resolveBase = res;
			rejectBase = rej;
		});
		base.catch(() => {}); // a prefetch may never await base; don't warn
		const final = (async () => {
			try {
				const md = await fetchReadme(key);
				if (!md) {
					readmeCache.set(key, '');
					resolveBase('');
					return '';
				}
				const { html, mermaids } = await renderBase(md, key);
				resolveBase(html); // phase 1 ready — text can paint now
				const f = await enhanceMermaid(html, mermaids);
				readmeCache.set(key, f);
				return f;
			} catch (e) {
				rejectBase(e);
				throw e;
			} finally {
				readmeInFlight.delete(key);
			}
		})();
		const entry = { base, final };
		readmeInFlight.set(key, entry);
		return entry;
	}

	async function loadReadme(repo) {
		const key = repo.full_name;
		if (readmeCache.has(key)) {
			readmeHtml = readmeCache.get(key);
			readmeState = readmeHtml ? 'loaded' : 'empty';
			return;
		}
		readmeHtml = '';
		readmeState = 'loading';
		const { base, final } = buildReadme(key);
		// Phase 1: paint text + highlighted code as soon as it's ready.
		try {
			const baseHtml = await base;
			if (selected?.full_name !== key) return;
			readmeHtml = baseHtml;
			readmeState = baseHtml ? 'loaded' : 'empty';
		} catch {
			if (selected?.full_name === key) readmeState = 'error';
			return;
		}
		// Phase 2: swap in mermaid diagrams once rendered (if any).
		try {
			const finalHtml = await final;
			if (selected?.full_name === key && finalHtml !== readmeHtml) readmeHtml = finalHtml;
		} catch {
			/* base already shown; diagrams just won't appear */
		}
	}

	// Warm the cache from hover/focus intent so the click feels instant.
	function prefetchReadme(repo) {
		const key = repo.full_name;
		if (readmeCache.has(key) || readmeInFlight.has(key)) return;
		buildReadme(key).final.catch(() => {}); // errors resurface via loadReadme
	}
	function cardEnter(row) {
		clearTimeout(hoverTimer);
		hoverTimer = setTimeout(() => prefetchReadme(row), 120);
	}
	function cardLeave() {
		clearTimeout(hoverTimer);
	}

	// Load (or restore from cache) whenever the modal opens on a new repo.
	$effect(() => {
		const repo = selected;
		if (repo) loadReadme(repo);
		else readmeState = 'idle';
	});

	// Prefetch prev/next READMEs as soon as we know where we are in the list.
	$effect(() => {
		const idx = selectedIdx;
		if (idx === -1) return;
		const prev = filteredRows[idx - 1];
		const next = filteredRows[idx + 1];
		if (prev) prefetchReadme(prev);
		if (next) prefetchReadme(next);
	});

	// "Jun 25, 2026" — for the modal's starred/updated lines.
	function formatDay(s) {
		if (!s) return '';
		const d = new Date(s);
		return isNaN(d) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
	}

	function updateURL() {
		const params = new URLSearchParams();
		for (const f of filters) {
			if (f.type === 'set') params.set(f.column, f.values.join(','));
			else if (f.type === 'range') params.set(f.column, `${f.min ?? ''}-${f.max ?? ''}`);
		}
		if (searchQuery) params.set('q', searchQuery);
		// Persist sort only when it differs from the default (most recently starred).
		if (sortKey !== 'starred_at') params.set('sort', sortKey);
		if (sortDir !== 'desc') params.set('dir', sortDir);
		if (selected) params.set('repo', selected.full_name);
		history.replaceState(null, '', params.toString() ? `?${params}` : location.pathname);
	}

	let pendingRepo = ''; // full_name to auto-select once rows load

	function restoreFromURL() {
		const params = new URLSearchParams(location.search);
		const restored = [];
		for (const [col, val] of params.entries()) {
			if (col === 'q') {
				searchQuery = val;
				searchField = val;
			} else if (col === 'sort') {
				if (SORT_OPTIONS.some((o) => o.key === val)) sortKey = val;
			} else if (col === 'dir') {
				if (val === 'asc' || val === 'desc') sortDir = val;
			} else if (col === 'repo') {
				pendingRepo = val;
			} else {
				const facet = FACETS.find((f) => f.column === col);
				if (!facet) continue;
				if (facet.type === 'range') {
					const [lo, hi] = val.split('-');
					restored.push({
						column: col,
						type: 'range',
						min: lo === '' ? null : Number(lo),
						max: hi === '' ? null : Number(hi),
					});
				} else {
					restored.push({ column: col, type: 'set', values: val.split(',') });
				}
			}
		}
		filters = restored;
	}

	function escapeHtml(str) {
		return str
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	// Escape closes the modal; arrow keys navigate; "/" focuses search.
	function onKeydown(e) {
		if (selected) {
			if (e.key === 'Escape') { closeModal(); return; }
			if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); navigate(1); return; }
			if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); navigate(-1); return; }
		}
		if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
		const t = e.target;
		if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
		e.preventDefault();
		searchInput?.focus();
	}

	// Lock page scroll while the modal is open so background content doesn't
	// scroll through the (semi-transparent) backdrop — the source of the bleed.
	$effect(() => {
		if (selected) {
			document.body.style.overflow = 'hidden';
			return () => { document.body.style.overflow = ''; };
		}
	});

	$effect(() => {
		if (selected && dialogEl) {
			requestAnimationFrame(() => dialogEl?.showModal());
		}
	});

	onMount(() => {
		reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		restoreFromURL();
		window.addEventListener('keydown', onKeydown);

		// Pre-warm the markdown render libs during idle time so the first README
		// (hover or click) skips the import cost. mermaid is left out — it's large
		// and only needed for repos whose README actually has a diagram.
		const warm = () => {
			import('marked');
			import('marked-highlight');
			import('highlight.js/lib/common');
			import('dompurify');
		};
		if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 3000 });
		else setTimeout(warm, 1500);

		const buffer = [];
		Papa.parse(DATA_URL, {
			download: true,
			header: true,
			skipEmptyLines: true,
			step: (res) => {
				buffer.push(mapRow(res.data));
				if (buffer.length >= 500) {
					rows = [...rows, ...buffer.splice(0)];
					loadedCount = rows.length;
					loading = false;
					status = `Loading… ${rows.length.toLocaleString()} repos`;
				}
			},
			complete: () => {
				if (buffer.length) rows = [...rows, ...buffer.splice(0)];
				loadedCount = rows.length;
				loading = false;
				status = `${rows.length.toLocaleString()} repos`;
				if (pendingRepo) {
					const match = rows.find(r => r.full_name === pendingRepo);
					if (match) { selected = match; }
					pendingRepo = '';
				}
			},
		});

		return () => window.removeEventListener('keydown', onKeydown);
	});
</script>

<div class="fb">
	<aside class="fb-sidebar">
		<div class="fb-sidebar-head">
			<span class="fb-brand-name">Filters</span>
			{#if filters.length || searchQuery}
				<button class="fb-clear" onclick={clearAll}>Clear all</button>
			{/if}
		</div>

		{#each facetData as { facet, counts, range } (facet.column)}
			<div class="fb-facet">
				<h3 class="fb-facet-title">{facet.label}</h3>

				{#if facet.type === 'range'}
					{#if range}
						{@const cf = getFilter(facet.column)}
						<div class="fb-range">
							<input
								type="number"
								placeholder={range.min}
								value={cf?.min ?? ''}
								oninput={(e) =>
									setRangeFilter(
										facet.column,
										e.currentTarget.value ? Number(e.currentTarget.value) : null,
										cf?.max ?? null
									)}
							/>
							<span>–</span>
							<input
								type="number"
								placeholder={range.max}
								value={cf?.max ?? ''}
								oninput={(e) =>
									setRangeFilter(
										facet.column,
										cf?.min ?? null,
										e.currentTarget.value ? Number(e.currentTarget.value) : null
									)}
							/>
						</div>
						<div class="fb-range-meta">
							min {range.min.toLocaleString()} · med {range.med.toLocaleString()} · max {range.max.toLocaleString()}
						</div>
					{/if}
				{:else}
					{@const isExp = expanded[facet.column]}
					{@const shown = isExp ? counts : counts.slice(0, facet.limit)}
					{#each shown as item (item.value)}
						<button
							class="fb-opt"
							aria-pressed={isChecked(facet.column, item.value)}
							onclick={() => toggleFilter(facet.column, item.value)}
							animate:flip={{ duration: 250, easing: quintOut }}
						>
							{#if item.value !== '__null__' && facet.column === 'language'}
								<span class="fb-opt-dot" style="background:{langColor(item.value)}"></span>
							{:else if item.value !== '__null__' && facet.column === 'topics'}
								<span class="fb-opt-dot" style="background:{topicColor(item.value)}"></span>
							{/if}
							<span class="fb-opt-label">{item.value === '__null__' ? '(none)' : item.value}</span>
							<span class="fb-opt-count">{item.cnt.toLocaleString()}</span>
						</button>
					{/each}
					{#if counts.length > facet.limit}
						<button class="fb-more" onclick={() => toggleExpand(facet.column)}>
							{isExp ? 'Show less' : `Show ${counts.length - facet.limit} more`}
						</button>
					{/if}
				{/if}
			</div>
		{/each}
	</aside>

	<div class="fb-main">
		<div class="fb-header">
			<div class="fb-brand">
				<span class="fb-brand-name">GitHub Stars</span>
			</div>

			<div class="fb-search">
				<input
					type="search"
					placeholder="Search stars…"
					bind:this={searchInput}
					bind:value={searchField}
					oninput={onSearchInput}
				/>
				<span class="fb-kbd">/</span>
			</div>

			<div class="fb-controls">
				<span class="fb-count">
					{displayCount.toLocaleString()}{loading ? '' : ` / ${(hasData ? rows.length : displayCount).toLocaleString()}`}
				</span>
				<select class="fb-sort" bind:value={sortKey} onchange={updateURL} aria-label="Sort by">
					{#each SORT_OPTIONS as opt}
						<option value={opt.key}>{opt.label}</option>
					{/each}
				</select>
				<button
					class="fb-sort-dir"
					aria-label="Toggle sort direction"
					onclick={() => { sortDir = sortDir === 'desc' ? 'asc' : 'desc'; updateURL(); }}
				>
					{sortDir === 'desc' ? '↓' : '↑'}
				</button>
			</div>
		</div>

		{#if loading}
			<div class="fb-state">Loading…</div>
		{:else if visibleRows.length === 0}
			<div class="fb-state">No results match your filters.</div>
		{:else}
			<div class="fb-grid">
				{#each visibleRows as row (row.full_name)}
					{@const topics = topicsOf(row)}
					<div
						class="repo-card"
						role="button"
						tabindex="0"
						onclick={(e) => openCard(row, e)}
						onkeydown={(e) => cardKey(row, e)}
						onpointerenter={() => cardEnter(row)}
						onpointerleave={cardLeave}
						onpointerdown={() => prefetchReadme(row)}
						onfocusin={() => prefetchReadme(row)}
						animate:flip={{ duration: reducedMotion ? 0 : 300, easing: quintOut }}
						in:scale={{ duration: reducedMotion ? 0 : 200, start: 0.97, easing: quintOut }}
						out:fade={{ duration: reducedMotion ? 0 : 120 }}
					>
						<div class="repo-top">
							<a class="repo-avatar-link" href={ownerUrl(row)} onclick={stopEvt} aria-label={ownerOf(row)}>
								{#if row.owner_avatar_url}
									<img class="repo-avatar" src={row.owner_avatar_url} alt="" loading="lazy" />
								{:else}
									<span class="repo-avatar"></span>
								{/if}
							</a>
							<span class="repo-title"><a class="repo-owner" href={ownerUrl(row)} onclick={stopEvt}>{ownerOf(row)}</a><span class="repo-slash">/</span><a class="repo-name" href={row.html_url} target="_blank" rel="noopener" onclick={(e) => { openCard(row, e); stopEvt(e); }}>{repoOf(row)}</a></span>
							<span class="repo-stars">
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
									<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />
								</svg>
								{formatStars(row.stargazers_count)}
							</span>
						</div>

						{#if row.description}
							<p class="repo-desc">{row.description}</p>
						{/if}

						{#if topics.length}
							<div class="repo-topics">
								{#each topics.slice(0, CARD_TOPICS) as topic}
									<span class="repo-topic"><span class="repo-topic-dot" style="background:{topicColor(topic)}"></span>{topic}</span>
								{/each}
								{#if topics.length > CARD_TOPICS}
									<span class="repo-topic-more">+{topics.length - CARD_TOPICS}</span>
								{/if}
							</div>
						{/if}

						<div class="repo-foot">
							{#if row.language}
								<span class="repo-lang">
									<span class="repo-lang-dot" style="background:{langColor(row.language)}"></span>
									{row.language}
								</span>
							{/if}
							{#if row.fork || row.archived}
								<span class="repo-flags">
									{#if row.fork}<span class="repo-flag">fork</span>{/if}
									{#if row.archived}<span class="repo-flag is-archived">archived</span>{/if}
								</span>
							{/if}
							<span class="repo-date">{formatDate(row.starred_at)}</span>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

{#if selected}
	{@const topics = topicsOf(selected)}
	<dialog
		bind:this={dialogEl}
		class="fb-modal"
		aria-label={selected.full_name}
		onclose={closeModal}
		onclick={(e) => { if (e.target === dialogEl) closeModal(); }}
		transition:fade={{ duration: reducedMotion ? 0 : 120 }}
	>
		<header class="fb-modal-head">
			<a class="repo-avatar-link" href={ownerUrl(selected)} aria-label={ownerOf(selected)}>
				{#if selected.owner_avatar_url}
					<img class="repo-avatar" src={selected.owner_avatar_url} alt="" />
				{:else}
					<span class="repo-avatar"></span>
				{/if}
			</a>
			<span class="fb-modal-title"><a class="repo-owner" href={ownerUrl(selected)}>{ownerOf(selected)}</a><span class="repo-slash">/</span>{repoOf(selected)}</span>
			<div class="fb-modal-nav hidden md:flex">
				<button onclick={() => navigate(-1)} disabled={selectedIdx <= 0} aria-label="Previous (←)">←</button>
				<span class="fb-modal-pos">{selectedIdx + 1}<span class="fb-modal-pos-sep">/</span>{filteredRows.length}</span>
				<button onclick={() => navigate(1)} disabled={selectedIdx >= filteredRows.length - 1} aria-label="Next (→)">→</button>
			</div>
			<button class="fb-modal-close" aria-label="Close" onclick={closeModal}>✕</button>
		</header>

		<div class="fb-modal-body">
			{#if selected.description}
				<p class="fb-modal-desc">{selected.description}</p>
			{/if}

			<div class="fb-modal-meta">
				{#if selected.language}
					<span class="repo-lang">
						<span class="repo-lang-dot" style="background:{langColor(selected.language)}"></span>
						{selected.language}
					</span>
				{/if}
				<span class="repo-stars">★ {selected.stargazers_count.toLocaleString()}</span>
				{#if selected.fork}<span class="repo-flag">fork</span>{/if}
				{#if selected.archived}<span class="repo-flag is-archived">archived</span>{/if}
			</div>

			<div class="fb-modal-dates">
				{#if selected.starred_at}<span>Starred {formatDay(selected.starred_at)}</span>{/if}
				{#if selected.updated_at}<span>Updated {formatDay(selected.updated_at)}</span>{/if}
				{#if selected.created_at}<span>Created {formatDay(selected.created_at)}</span>{/if}
			</div>

			{#if topics.length}
				<div class="fb-modal-sep"></div>
				<div class="repo-topics">
					{#each topics as topic}
						<span class="repo-topic"><span class="repo-topic-dot" style="background:{topicColor(topic)}"></span>{topic}</span>
					{/each}
				</div>
			{/if}

			<div class="fb-modal-sep"></div>
			<div class="fb-modal-links">
				<a class="fb-link" href={selected.html_url} target="_blank" rel="noopener noreferrer">View on GitHub ↗</a>
				{#if selected.homepage && selected.homepage !== selected.html_url}
					<a class="fb-link" href={selected.homepage} target="_blank" rel="noopener noreferrer">Homepage ↗</a>
				{/if}
			</div>

			<div class="fb-modal-sep"></div>
			<div class="fb-readme-head">README</div>
			{#if readmeState === 'loading'}
				<div class="fb-readme-state">Loading README…</div>
			{:else if readmeState === 'empty'}
				<div class="fb-readme-state">No README found for this repo.</div>
			{:else if readmeState === 'error'}
				<div class="fb-readme-state">Couldn't load the README.</div>
			{:else if readmeState === 'loaded'}
				<!-- readmeHtml is sanitized with DOMPurify in renderMarkdown -->
				<div class="readme">{@html readmeHtml}</div>
			{/if}
		</div>

		<div class="fb-modal-mobile-nav md:hidden">
			<button onclick={() => navigate(-1)} disabled={selectedIdx <= 0} aria-label="Previous">‹</button>
			<span class="fb-modal-pos">{selectedIdx + 1}<span class="fb-modal-pos-sep">/</span>{filteredRows.length}</span>
			<button onclick={() => navigate(1)} disabled={selectedIdx >= filteredRows.length - 1} aria-label="Next">›</button>
		</div>
	</dialog>
{/if}
