import { sha256Hex } from '../flags';
import { FONT_BASELINES, FONT_CANDIDATES, fontDetected, type Signals } from './signals';

/**
 * Reads the signals listed on /whoami, and nothing else. Every API used
 * here is local to the browser: no network, no storage. Only ever called
 * after the visitor presses "Inspect my traffic".
 */

interface UADataLike {
	brands: { brand: string; version: string }[];
	mobile: boolean;
	platform: string;
	getHighEntropyValues(hints: string[]): Promise<Record<string, string | undefined>>;
}

async function clientHints(): Promise<string | null> {
	const uad = (navigator as Navigator & { userAgentData?: UADataLike }).userAgentData;
	if (!uad) return null;
	const brands = uad.brands
		.filter((b) => !/not.?a.?brand/i.test(b.brand))
		.map((b) => `${b.brand} ${b.version}`)
		.join(', ');
	let high: Record<string, string | undefined> = {};
	try {
		high = await uad.getHighEntropyValues(['architecture', 'bitness', 'model', 'platformVersion']);
	} catch {
		// Some browsers refuse high-entropy hints; the low-entropy ones still count.
	}
	const platform = [uad.platform, high.platformVersion].filter(Boolean).join(' ');
	const arch = [high.architecture, high.bitness && `${high.bitness}-bit`].filter(Boolean).join(' ');
	return [brands, platform, arch, high.model, uad.mobile ? 'mobile' : 'desktop'].filter(Boolean).join('; ');
}

function renderCanvas(): string | null {
	try {
		const canvas = document.createElement('canvas');
		canvas.width = 280;
		canvas.height = 60;
		const ctx = canvas.getContext('2d');
		if (!ctx) return null;
		const text = 'You are the traffic <canvas> 1.0 \u{1F50E}';
		ctx.textBaseline = 'top';
		ctx.font = '16px Arial, sans-serif';
		ctx.fillStyle = '#f60';
		ctx.fillRect(120, 2, 70, 22);
		ctx.fillStyle = '#069';
		ctx.fillText(text, 2, 16);
		ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
		ctx.fillText(text, 5, 19);
		const gradient = ctx.createLinearGradient(0, 0, 280, 0);
		gradient.addColorStop(0, '#a8281c');
		gradient.addColorStop(1, '#1e2318');
		ctx.strokeStyle = gradient;
		ctx.beginPath();
		ctx.arc(250, 30, 18, 0, Math.PI * 1.7);
		ctx.stroke();
		return canvas.toDataURL();
	} catch {
		return null;
	}
}

function detectFonts(): string[] {
	const ctx = document.createElement('canvas').getContext('2d');
	if (!ctx) return [];
	const sample = 'mmmmmmmmmmlli1|WQ@#';
	const measure = (family: string) => {
		ctx.font = `72px ${family}`;
		return ctx.measureText(sample).width;
	};
	const baseline = Object.fromEntries(FONT_BASELINES.map((b) => [b, measure(b)])) as Record<(typeof FONT_BASELINES)[number], number>;
	return FONT_CANDIDATES.filter((font) =>
		fontDetected(baseline, Object.fromEntries(FONT_BASELINES.map((b) => [b, measure(`"${font}", ${b}`)])) as typeof baseline),
	);
}

export async function collectSignals(): Promise<Signals> {
	const first = renderCanvas();
	const second = renderCanvas();
	const [hints, canvasHash] = await Promise.all([clientHints(), first ? sha256Hex(first) : Promise.resolve(null)]);
	const cpu = navigator.hardwareConcurrency;
	return {
		userAgent: navigator.userAgent,
		clientHints: hints,
		languages: [...(navigator.languages ?? [navigator.language])],
		timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		utcOffsetMinutes: -new Date().getTimezoneOffset(),
		screen: {
			width: screen.width,
			height: screen.height,
			colorDepth: screen.colorDepth,
			pixelRatio: Math.round(window.devicePixelRatio * 100) / 100,
		},
		colorScheme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
		cpuThreads: typeof cpu === 'number' && cpu > 0 ? cpu : null,
		canvasHash,
		canvasRandomized: first !== null && second !== null && first !== second,
		fontsDetected: detectFonts(),
		fontsChecked: FONT_CANDIDATES.length,
	};
}
