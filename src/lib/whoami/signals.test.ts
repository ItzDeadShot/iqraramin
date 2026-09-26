import { describe, expect, it } from 'vitest';
import {
	FONT_CANDIDATES,
	SIGNAL_INFO,
	WHOLE_FINGERPRINT_BITS,
	flowRecord,
	fontDetected,
	formatUtcOffset,
	naiveBitsSum,
	oneIn,
	verdict,
	type Signals,
} from './signals';

const base: Signals = {
	userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
	clientHints: 'Chromium 140, Linux',
	languages: ['en-US', 'en'],
	timezone: 'Asia/Kuala_Lumpur',
	utcOffsetMinutes: 480,
	screen: { width: 1920, height: 1080, colorDepth: 24, pixelRatio: 1 },
	colorScheme: 'dark',
	cpuThreads: 8,
	canvasHash: 'ab'.repeat(32),
	canvasRandomized: false,
	fontsDetected: ['Arial', 'DejaVu Sans'],
	fontsChecked: FONT_CANDIDATES.length,
};

describe('font detection', () => {
	const baseline = { monospace: 400, serif: 380, 'sans-serif': 390 };

	it('is false when every width falls through to its baseline', () => {
		expect(fontDetected(baseline, { ...baseline })).toBe(false);
	});

	it('is true when any baseline measures differently', () => {
		expect(fontDetected(baseline, { ...baseline, serif: 372.5 })).toBe(true);
	});

	it('ignores sub-pixel noise', () => {
		expect(fontDetected(baseline, { monospace: 400.05, serif: 380, 'sans-serif': 390 })).toBe(false);
	});

	it("never checks the site's own web fonts (that could trigger a download)", () => {
		for (const own of ['Fraunces', 'JetBrains Mono', 'Iqrar Wordmark']) expect(FONT_CANDIDATES).not.toContain(own);
	});
});

describe('identifying-power figures', () => {
	it('uses the published per-variable figures', () => {
		const bits = Object.fromEntries(SIGNAL_INFO.map((s) => [s.key, s.bits]));
		expect(bits.userAgent).toBe(10.0);
		expect(bits.timezone).toBe(3.04);
		expect(bits.screen).toBe(4.83);
		expect(bits.language).toBe(6.09);
		// AmIUnique: normalized entropy 0.491 over 118,934 fingerprints.
		expect(bits.canvas).toBeCloseTo(0.491 * Math.log2(118_934), 1);
	});

	it('cites a source for every figure, and gives no number where none was measured', () => {
		for (const s of SIGNAL_INFO) {
			if (s.bits === null) expect(s.source).toBeNull();
			else expect(s.source).not.toBeNull();
		}
	});

	it('shows why the naive sum overcounts: it exceeds the measured whole-fingerprint figure', () => {
		expect(naiveBitsSum()).toBeGreaterThan(WHOLE_FINGERPRINT_BITS);
		expect(oneIn(WHOLE_FINGERPRINT_BITS)).toBeGreaterThan(280_000);
		expect(oneIn(WHOLE_FINGERPRINT_BITS)).toBeLessThan(290_000);
	});
});

describe('flow record and verdict', () => {
	it('formats UTC offsets both ways', () => {
		expect(formatUtcOffset(480)).toBe('UTC+08:00');
		expect(formatUtcOffset(-330)).toBe('UTC-05:30');
		expect(formatUtcOffset(0)).toBe('UTC+00:00');
	});

	it('renders one row per collected signal, in a stable order', () => {
		const rows = flowRecord(base);
		expect(rows.map((r) => r.signal)).toEqual(SIGNAL_INFO.map((s) => s.key));
		expect(rows.find((r) => r.field === 'src.fonts')!.value).toBe(`2 of ${FONT_CANDIDATES.length} checked: Arial, DejaVu Sans`);
	});

	it('says so when things are hidden or randomized', () => {
		const rows = flowRecord({ ...base, cpuThreads: null, clientHints: null, canvasRandomized: true });
		expect(rows.find((r) => r.signal === 'cpuThreads')!.value).toBe('(hidden)');
		expect(rows.find((r) => r.signal === 'clientHints')!.value).toMatch(/not offered/);
		expect(rows.find((r) => r.signal === 'canvas')!.value).toMatch(/randomizing/);
	});

	it('is always benign, with reasons drawn from the signals', () => {
		expect(verdict(base).label).toBe('BENIGN');
		expect(verdict(base).rationale.join(' ')).toMatch(/2 common fonts/);
		expect(verdict({ ...base, userAgent: 'Mozilla/5.0 HeadlessChrome/140.0' }).rationale.join(' ')).toMatch(/test harness/);
		expect(verdict({ ...base, canvasRandomized: true }).rationale.join(' ')).toMatch(/resisting canvas/);
	});
});
