import { getCollection } from 'astro:content';
import { FLAG_LOCATIONS, type FlagLocation } from './flags';

/** All flags, after checks the per-entry schema can't do: exactly one flag
 * per location and no flag used twice. */
export async function getFlags() {
	const entries = await getCollection('flags');
	const byLocation = new Map(entries.map((e) => [e.data.location, e]));
	const missing = FLAG_LOCATIONS.filter((l) => !byLocation.has(l));
	if (missing.length) throw new Error(`flags.yaml has no flag for: ${missing.join(', ')}`);
	if (byLocation.size !== entries.length) throw new Error('flags.yaml uses a location more than once');
	if (new Set(entries.map((e) => e.data.flag)).size !== entries.length) throw new Error('flags.yaml repeats a flag value');
	return entries;
}

export async function flagFor(location: FlagLocation): Promise<string> {
	const entry = (await getFlags()).find((e) => e.data.location === location);
	return entry!.data.flag;
}
