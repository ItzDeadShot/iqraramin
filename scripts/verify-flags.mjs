// Post-build check for the capture-the-flag (runs as part of `pnpm build`).
// Uses only what shipped: the six SHA-256 hashes on /flags, and every
// Q{...} string found anywhere in dist/. Fails the build unless each flag
// is findable in exactly one built file and none leaks onto /flags itself.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = process.argv[2] ?? 'dist';
const TEXT = /\.(html|txt|js|mjs|css|json|xml|svg|webmanifest)$/;
const FLAG = /Q\{[a-z0-9_]{4,60}\}/g;

const board = readFileSync(join(DIST, 'flags/index.html'), 'utf8');
const json = /<script type="application\/json" id="fb-data">([\s\S]*?)<\/script>/.exec(board)?.[1];
if (!json) {
	console.error('verify-flags: could not find the flag data block on /flags');
	process.exit(1);
}
const { slots } = JSON.parse(json);

function* walk(dir) {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) yield* walk(path);
		else if (TEXT.test(name)) yield path;
	}
}

const filesByHash = new Map();
for (const path of walk(DIST)) {
	for (const match of new Set(readFileSync(path, 'utf8').match(FLAG) ?? [])) {
		const hash = createHash('sha256').update(match).digest('hex');
		filesByHash.set(hash, [...(filesByHash.get(hash) ?? []), relative(DIST, path)]);
	}
}

const problems = [];
const lines = [];
for (const slot of slots) {
	const files = filesByHash.get(slot.hash) ?? [];
	if (files.length === 0) problems.push(`"${slot.title}" is not findable anywhere in ${DIST}/`);
	else if (files.length > 1) problems.push(`"${slot.title}" appears in ${files.length} files (${files.join(', ')}); it should be in exactly one`);
	if (files.includes('flags/index.html')) problems.push(`"${slot.title}" leaks onto the /flags scoreboard`);
	lines.push(`  ${slot.title.padEnd(24)} ${files.join(', ') || 'MISSING'}`);
}

if (problems.length) {
	console.error(`verify-flags: FAILED\n${problems.map((p) => `  - ${p}`).join('\n')}`);
	process.exit(1);
}
console.log(`verify-flags: all ${slots.length} flags present, each in exactly one built file, none on /flags\n${lines.join('\n')}`);
