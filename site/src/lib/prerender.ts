// Build-time prerender of the "natural first page" (no filters, no search,
// sorted by stars desc) for the faceted-browse takes. Runs in Node during
// `astro build` (and dev SSR): reads the same CSV the client streams, computes
// facet counts + the top result cards, and returns HTML strings that match the
// client render exactly. The client replaces these containers via innerHTML on
// boot, so there's no hydration mismatch — this just paints real content
// before the CSV downloads and parses in the browser.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Papa from 'papaparse';

const CSV_PATH = join(process.cwd(), 'public', 'data', 'stars.csv');

// Mirror the client data model (see takes' mapRow).
const NUMERIC_COLS = new Set(['stargazers_count', 'forks_count', 'open_issues_count']);
const BOOLEAN_COLS = new Set(['fork', 'archived']);

interface Row {
	full_name: string;
	description: string | null;
	language: string | null;
	topics: string;
	license_name: string | null;
	stargazers_count: number;
	html_url: string;
	fork: boolean;
	archived: boolean;
}

// Facet definitions — must match the takes' FACETS array.
const FACETS = [
	{ column: 'language', type: 'set', label: 'Language', limit: 12 },
	{ column: 'topics', type: 'set', label: 'Topics', limit: 15, multi: true },
	{ column: 'license_name', type: 'set', label: 'License', limit: 8 },
	{ column: 'stargazers_count', type: 'range', label: 'Stars' },
	{ column: 'fork', type: 'set', label: 'Fork', limit: 2, boolean: true },
	{ column: 'archived', type: 'set', label: 'Archived', limit: 2, boolean: true },
] as const;

const NULL_SENTINEL = '__null__';
// How many cards to bake in. The client virtual-scroll only renders a visible
// slice; this fills a tall viewport at scrollTop 0, then the client takes over.
const INITIAL_CARDS = 30;
const CARD_HEIGHT = 140; // keep in sync with takes' CARD_HEIGHT

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function mapRow(o: Record<string, any>): Row {
	const obj: any = {};
	for (const h in o) {
		let v: any = o[h];
		if (v === '' || v == null) v = null;
		else if (NUMERIC_COLS.has(h)) v = Number(v);
		else if (BOOLEAN_COLS.has(h)) v = v === 'true';
		obj[h] = v;
	}
	return obj as Row;
}

function computeFacetCounts(facet: any, rows: Row[]): { value: any; cnt: number }[] {
	const counts = new Map<any, number>();
	for (const r of rows) {
		if (facet.multi) {
			if (!r.topics) {
				counts.set(null, (counts.get(null) ?? 0) + 1);
			} else {
				const seen = new Set<string>();
				for (const t of r.topics.split(',')) {
					const trimmed = t.trim();
					if (trimmed && !seen.has(trimmed)) {
						seen.add(trimmed);
						counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
					}
				}
			}
		} else {
			const val = (r as any)[facet.column];
			const key = val === null || val === undefined ? null : val;
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
	}
	let arr = [...counts.entries()].map(([value, cnt]) => ({ value, cnt }));
	arr.sort((a, b) => b.cnt - a.cnt);
	if (facet.limit) arr = arr.slice(0, facet.limit);
	return arr;
}

function computeRange(rows: Row[]): { min: number; max: number; med: number } | null {
	const vals = rows.map((r) => r.stargazers_count).filter((v) => v != null);
	if (!vals.length) return null;
	vals.sort((a, b) => a - b);
	return { min: vals[0], max: vals[vals.length - 1], med: vals[Math.floor(vals.length / 2)] };
}

function renderFacetsHtml(rows: Row[]): string {
	const html: string[] = [];
	for (const facet of FACETS) {
		if (facet.type === 'range') {
			const r = computeRange(rows);
			if (!r) continue;
			html.push(`
				<div class="facet-section" data-column="${facet.column}">
					<h3>${facet.label}</h3>
					<div class="facet-range">
						<input type="number" class="range-min" placeholder="${r.min}" value="" />
						<span>–</span>
						<input type="number" class="range-max" placeholder="${r.max}" value="" />
					</div>
					<div class="facet-range-meta">min ${r.min} · med ${r.med} · max ${r.max}</div>
				</div>
			`);
			continue;
		}
		const counts = computeFacetCounts(facet, rows);
		const items = counts
			.map((c) => {
				const isNull = c.value === null || c.value === undefined;
				const label = isNull ? '(none)' : facet.boolean ? String(c.value) : c.value;
				const dataVal = isNull ? NULL_SENTINEL : String(c.value);
				return `
					<label class="facet-item">
						<input type="checkbox" class="checkbox" data-column="${facet.column}" data-value="${dataVal.replace(/"/g, '&quot;')}" />
						<span class="facet-label">${escapeHtml(label)}</span>
						<span class="facet-count">${c.cnt}</span>
					</label>
				`;
			})
			.join('');
		html.push(`
			<div class="facet-section" data-column="${facet.column}">
				<h3>${facet.label}</h3>
				${items}
			</div>
		`);
	}
	return html.join('');
}

function renderCardHtml(r: Row): string {
	return `
		<a class="card h-[132px] overflow-hidden transition-colors hover:border-foreground/40" href="${r.html_url ?? '#'}" target="_blank" rel="noopener">
			<div class="card-header">
				<div class="card-title truncate">${escapeHtml(r.full_name ?? '')}</div>
				${r.description ? `<div class="card-description line-clamp-2">${escapeHtml(r.description)}</div>` : ''}
			</div>
			<div class="card-content flex items-center gap-2 text-[13px]">
				${r.language ? `<span class="badge badge-secondary">${escapeHtml(r.language)}</span>` : ''}
				<span class="text-muted-foreground tabular-nums">★ ${Number(r.stargazers_count).toLocaleString()}</span>
			</div>
		</a>
	`;
}

export interface FirstPage {
	facetsHtml: string;
	resultsHtml: string;
	statusText: string;
}

let cached: FirstPage | null = null;
let rowsCache: Row[] | null = null;

function loadRows(): Row[] {
	if (rowsCache) return rowsCache;
	const csv = readFileSync(CSV_PATH, 'utf8');
	const parsed = Papa.parse<Record<string, any>>(csv, {
		header: true,
		skipEmptyLines: true,
	});
	rowsCache = parsed.data.map(mapRow);
	return rowsCache;
}

export function prerenderFirstPage(): FirstPage {
	if (cached) return cached;

	const rows = loadRows();

	// Default sort: stars desc, nulls last (matches takes' sortRows).
	const sorted = [...rows].sort((a, b) => {
		const va = a.stargazers_count;
		const vb = b.stargazers_count;
		if (va == null && vb == null) return 0;
		if (va == null) return 1;
		if (vb == null) return -1;
		return vb - va;
	});

	const total = rows.length.toLocaleString();
	const cards = sorted.slice(0, INITIAL_CARDS).map(renderCardHtml).join('');

	const resultsHtml = `
		<div class="vs-viewport" id="vs-viewport">
			<div class="vs-spacer" style="height: ${sorted.length * CARD_HEIGHT}px;">
				<div class="vs-cards" id="vs-cards" style="transform: translateY(0px);">${cards}</div>
			</div>
		</div>
	`;

	cached = {
		facetsHtml: renderFacetsHtml(rows),
		resultsHtml,
		statusText: `${total} / ${total} repos`,
	};
	return cached;
}

// ---- Svelte island fallback -------------------------------------------------
// The Svelte take renders its facets/cards from `$state`/`$derived`, so it gets
// data (not HTML strings): the SSR pass renders these as the island's fallback,
// and the component falls back to them until its own CSV load completes on the
// client. Counts use String keys + '__null__' to match the component's
// computeFacetCounts; values that don't match would cause a hydration mismatch.

// Mirror the component's FACETS (fork/archived have no limit there).
const SVELTE_FACETS = [
	{ column: 'language', type: 'set', label: 'Language', limit: 12 },
	{ column: 'topics', type: 'set', label: 'Topics', limit: 15, multi: true },
	{ column: 'license_name', type: 'set', label: 'License', limit: 8 },
	{ column: 'stargazers_count', type: 'range', label: 'Stars' },
	{ column: 'fork', type: 'set', label: 'Fork', boolean: true },
	{ column: 'archived', type: 'set', label: 'Archived', boolean: true },
] as const;

function svelteFacetCounts(facet: any, rows: Row[]): { value: string; cnt: number }[] {
	const counts = new Map<string, number>();
	for (const r of rows) {
		if (facet.multi) {
			if (!r.topics) {
				counts.set('__null__', (counts.get('__null__') ?? 0) + 1);
			} else {
				const seen = new Set<string>();
				for (const t of r.topics.split(',')) {
					const trimmed = t.trim();
					if (trimmed && !seen.has(trimmed)) {
						seen.add(trimmed);
						counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
					}
				}
			}
		} else {
			const val = (r as any)[facet.column];
			const key = val === null || val === undefined ? '__null__' : String(val);
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
	}
	let arr = [...counts.entries()].map(([value, cnt]) => ({ value, cnt }));
	arr.sort((a, b) => b.cnt - a.cnt);
	if (facet.limit) arr = arr.slice(0, facet.limit);
	return arr;
}

// Only the fields the card template reads — keeps the serialized prop small.
interface SvelteCard {
	full_name: string;
	description: string | null;
	html_url: string;
	language: string | null;
	fork: boolean;
	archived: boolean;
	stargazers_count: number;
	owner_avatar_url: string | null;
	owner_name: string | null;
	topics: string | null;
	starred_at: string | null;
	updated_at: string | null;
	created_at: string | null;
	homepage: string | null;
}

export interface SvelteFirstPage {
	facetData: any[];
	visibleRows: SvelteCard[];
	resultCount: number;
	status: string;
}

let svelteCached: SvelteFirstPage | null = null;

export function prerenderSvelteFirstPage(): SvelteFirstPage {
	if (svelteCached) return svelteCached;
	const rows = loadRows();

	const facetData = SVELTE_FACETS.map((facet) => {
		if (facet.type === 'range') {
			return { facet, range: computeRange(rows) };
		}
		return { facet, counts: svelteFacetCounts(facet, rows) };
	});

	// Default sort: most recently starred first (matches the component's
	// sortKey='starred_at', sortDir='desc' — string compare, nulls last).
	const sorted = [...rows].sort((a, b) => {
		const va = (a as any).starred_at;
		const vb = (b as any).starred_at;
		if (va == null && vb == null) return 0;
		if (va == null) return 1;
		if (vb == null) return -1;
		return String(vb).localeCompare(String(va));
	});
	const visibleRows: SvelteCard[] = sorted.slice(0, INITIAL_CARDS).map((r) => ({
		full_name: r.full_name,
		description: r.description,
		html_url: r.html_url,
		language: r.language,
		fork: r.fork,
		archived: r.archived,
		stargazers_count: r.stargazers_count,
		owner_avatar_url: (r as any).owner_avatar_url ?? null,
		owner_name: (r as any).owner_name ?? null,
		topics: (r as any).topics ?? null,
		starred_at: (r as any).starred_at ?? null,
		updated_at: (r as any).updated_at ?? null,
		created_at: (r as any).created_at ?? null,
		homepage: (r as any).homepage ?? null,
	}));

	svelteCached = {
		facetData,
		visibleRows,
		resultCount: rows.length,
		status: `${rows.length.toLocaleString()} repos`,
	};
	return svelteCached;
}
