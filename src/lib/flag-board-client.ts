import { FLAG_PATTERN, hintViews, matchFlag, normalizeFlag, type FlagSlot } from './flags';

const STORAGE_KEY = 'q-site-flags-v1';

/** Progress lives only in this browser. Storage can be blocked (private
 * windows, strict settings), so every access is guarded and the board
 * still works without it; progress just won't persist. */
function loadFound(): Record<string, string> | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		const parsed: unknown = raw ? JSON.parse(raw) : {};
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
	} catch {
		return null;
	}
}

function saveFound(found: Record<string, string>): boolean {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(found));
		return true;
	} catch {
		return false;
	}
}

function clearFound(): void {
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch {
		// Nothing stored, nothing to clear.
	}
}

export function initFlagBoard(root: HTMLElement): void {
	const dataEl = root.querySelector('#fb-data');
	const form = root.querySelector<HTMLFormElement>('[data-form]');
	const input = root.querySelector<HTMLInputElement>('#fb-input');
	const result = root.querySelector<HTMLElement>('[data-result]');
	const progress = root.querySelector<HTMLElement>('[data-progress]');
	const resetBtn = root.querySelector<HTMLButtonElement>('[data-reset]');
	if (!dataEl?.textContent || !form || !input || !result || !progress) return;

	const { slots } = JSON.parse(dataEl.textContent) as { slots: FlagSlot[] };
	const stored = loadFound();
	const storageWorks = stored !== null;
	// Only keep entries for flags that still exist.
	const found: Record<string, string> = Object.fromEntries(
		Object.entries(stored ?? {}).filter(([id, v]) => slots.some((s) => s.id === id) && typeof v === 'string'),
	);

	root.querySelectorAll<HTMLInputElement | HTMLButtonElement>('[data-requires-js]').forEach((c) => (c.disabled = false));

	function render(): void {
		const count = Object.keys(found).length;
		for (const slot of slots) {
			const li = root.querySelector<HTMLElement>(`[data-slot="${slot.id}"]`);
			if (!li) continue;
			const isFound = slot.id in found;
			li.dataset.found = String(isFound);
			const status = li.querySelector('[data-status]');
			if (status) status.textContent = isFound ? 'Found' : 'Unfound';
			const flagEl = li.querySelector<HTMLElement>('[data-found-flag]');
			if (flagEl) {
				flagEl.hidden = !isFound;
				flagEl.textContent = isFound ? found[slot.id] : '';
			}
			li.querySelector('[data-hints]')?.replaceChildren(
				...hintViews(slot, count).map((h) => {
					const item = document.createElement('li');
					if (h.locked) {
						item.className = 'fb-hint-locked mono';
						item.textContent = `Locked: find ${h.remaining} more flag${h.remaining === 1 ? '' : 's'}`;
					} else {
						item.textContent = h.text;
					}
					return item;
				}),
			);
		}
		progress!.textContent =
			count === slots.length ? `All ${slots.length} found. Nicely done.` : `${count} of ${slots.length} found`;
	}

	form.addEventListener('submit', async (evt) => {
		evt.preventDefault();
		const guess = normalizeFlag(input.value);
		if (!guess) {
			result.textContent = 'Paste a flag first.';
			return;
		}
		if (!FLAG_PATTERN.test(guess)) {
			result.textContent = "That doesn't look like a flag. Flags look like Q{some_lowercase_words}.";
			return;
		}
		const slot = await matchFlag(guess, slots);
		if (!slot) {
			result.textContent = 'Not one of the six. Keep looking.';
			return;
		}
		if (slot.id in found) {
			result.textContent = `Already found: ${slot.title}.`;
			return;
		}
		found[slot.id] = guess;
		const saved = saveFound(found);
		input.value = '';
		result.textContent =
			`Found: ${slot.title}.` + (saved ? '' : " (Your browser is blocking storage, so progress won't survive a reload.)");
		render();
	});

	let resetArmed = false;
	let resetTimer: number | undefined;
	resetBtn?.addEventListener('click', () => {
		if (!resetArmed) {
			resetArmed = true;
			resetBtn.textContent = 'Click again to reset';
			resetTimer = window.setTimeout(() => {
				resetArmed = false;
				resetBtn.textContent = 'Reset progress';
			}, 4000);
			return;
		}
		window.clearTimeout(resetTimer);
		resetArmed = false;
		resetBtn.textContent = 'Reset progress';
		for (const id of Object.keys(found)) delete found[id];
		clearFound();
		result.textContent = 'Progress reset.';
		render();
	});

	result.textContent = storageWorks ? '' : "Your browser is blocking storage, so progress won't be saved, but checking still works.";
	render();
}
