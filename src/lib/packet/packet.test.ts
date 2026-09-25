import { describe, expect, it } from 'vitest';
import {
	MAX_PAYLOAD,
	PAYLOAD_OFFSET,
	asciiCell,
	bioToPayloadText,
	buildPacket,
	dissect,
	internetChecksum,
	type PacketConfig,
} from './packet';

const bytes = (hex: string) => Uint8Array.from(hex.replace(/\s+/g, '').match(/../g)!.map((h) => parseInt(h, 16)));

const config: PacketConfig = {
	ethernet: { src: 'de:ad:be:ef:13:37', dst: '02:c0:ff:ee:00:01' },
	ipv4: { src: '192.0.2.13', dst: '198.51.100.7', ttl: 64, identification: 0x1337, dscp: 0, dontFragment: true },
	tcp: { srcPort: 31337, dstPort: 443, seq: 1337, ack: 1, flags: ['PSH', 'ACK'], window: 64240, urgentPointer: 0 },
};

describe('internetChecksum', () => {
	it('matches the RFC 1071 worked example', () => {
		// RFC 1071 section 3: the one's-complement sum of these words is 0xddf2.
		expect(internetChecksum(bytes('0001 f203 f4f5 f6f7'))).toBe(~0xddf2 & 0xffff);
	});

	it('matches a well-known IPv4 header checksum', () => {
		// 192.168.0.1 -> 192.168.0.199, UDP, checksum field zeroed: 0xb861.
		expect(internetChecksum(bytes('4500 0073 0000 4000 4011 0000 c0a8 0001 c0a8 00c7'))).toBe(0xb861);
	});

	it('pads an odd trailing byte with zero, including across chunks', () => {
		expect(internetChecksum(bytes('0102 03'))).toBe(internetChecksum(bytes('0102 0300')));
		expect(internetChecksum(bytes('01'), bytes('02 03'))).toBe(internetChecksum(bytes('0102 03')));
	});

	it('is zero over data that already includes its checksum', () => {
		const header = bytes('4500 0073 0000 4000 4011 b861 c0a8 0001 c0a8 00c7');
		expect(internetChecksum(header)).toBe(0);
	});
});

describe('buildPacket / dissect round trip', () => {
	const text = bioToPayloadText(['Hello from the payload.', 'Second paragraph, odd length!']);
	const frame = buildPacket(config, text);
	const d = dissect(frame);

	it('lays out Ethernet II, IPv4 and TCP headers at the right sizes', () => {
		expect(frame.length).toBe(PAYLOAD_OFFSET + new TextEncoder().encode(text).length);
		expect(d.layers.map((l) => l.id)).toEqual(['frame', 'eth', 'ip', 'tcp', 'data']);
	});

	it('parses every configured value back out of the bytes', () => {
		expect(d.ethernet).toEqual({ src: config.ethernet.src, dst: config.ethernet.dst, type: 0x0800 });
		expect(d.ipv4).toMatchObject({
			version: 4,
			ihl: 5,
			dscp: 0,
			totalLength: frame.length - 14,
			identification: 0x1337,
			dontFragment: true,
			moreFragments: false,
			fragmentOffset: 0,
			ttl: 64,
			protocol: 6,
			src: config.ipv4.src,
			dst: config.ipv4.dst,
		});
		expect(d.tcp).toMatchObject({
			srcPort: 31337,
			dstPort: 443,
			seq: 1337,
			ack: 1,
			dataOffset: 5,
			window: 64240,
			urgentPointer: 0,
		});
		expect([...d.tcp.flags].sort()).toEqual(['ACK', 'PSH']);
		expect(d.payloadText).toBe(text);
	});

	it('has valid IPv4 and TCP checksums', () => {
		expect(d.ipv4.checksumOk).toBe(true);
		expect(d.tcp.checksumOk).toBe(true);
		expect(d.layers.find((l) => l.id === 'ip')!.fields.some((f) => f.label.includes('[correct]'))).toBe(true);
	});

	it('every field range lies inside its layer, and layers tile the frame', () => {
		for (const layer of d.layers) {
			for (const f of layer.fields) {
				expect(f.start).toBeGreaterThanOrEqual(layer.start);
				expect(f.end).toBeLessThanOrEqual(layer.end);
				expect(f.end).toBeGreaterThan(f.start);
			}
		}
		const [, eth, ip, tcp, data] = d.layers;
		expect([eth.end, ip.end, tcp.end, data.end]).toEqual([ip.start, tcp.start, data.start, frame.length]);
	});
});

describe('checksums catch corruption', () => {
	const frame = buildPacket(config, 'integrity check');

	it('a flipped payload bit breaks only the TCP checksum', () => {
		const bad = Uint8Array.from(frame);
		bad[PAYLOAD_OFFSET + 3] ^= 0x01;
		const d = dissect(bad);
		expect(d.ipv4.checksumOk).toBe(true);
		expect(d.tcp.checksumOk).toBe(false);
		expect(d.layers.find((l) => l.id === 'tcp')!.fields.some((f) => f.label.includes('[incorrect]'))).toBe(true);
	});

	it('a changed TTL breaks the IPv4 header checksum', () => {
		const bad = Uint8Array.from(frame);
		bad[14 + 8] = 1;
		expect(dissect(bad).ipv4.checksumOk).toBe(false);
	});

	it('a changed source address breaks both (TCP covers it via the pseudo-header)', () => {
		const bad = Uint8Array.from(frame);
		bad[14 + 15] ^= 0xff;
		const d = dissect(bad);
		expect(d.ipv4.checksumOk).toBe(false);
		expect(d.tcp.checksumOk).toBe(false);
	});
});

describe('payload handling', () => {
	it('round-trips multi-byte UTF-8', () => {
		const text = 'Café, naïve, 🔐 ok';
		const d = dissect(buildPacket(config, text));
		expect(d.payloadText).toBe(text);
		expect(d.tcp.checksumOk).toBe(true);
	});

	it('rejects a payload larger than one MTU-sized segment', () => {
		expect(() => buildPacket(config, 'x'.repeat(MAX_PAYLOAD + 1))).toThrow(/Shorten the bio/);
		expect(() => buildPacket(config, 'x'.repeat(MAX_PAYLOAD))).not.toThrow();
	});

	it('rejects malformed addresses', () => {
		expect(() => buildPacket({ ...config, ethernet: { ...config.ethernet, src: 'de:ad:be:ef' } }, 'x')).toThrow(/MAC/);
		expect(() => buildPacket({ ...config, ipv4: { ...config.ipv4, dst: '300.1.1.1' } }, 'x')).toThrow(/IPv4/);
	});

	it('shows only printable ASCII in the ASCII column', () => {
		expect(asciiCell(0x41)).toBe('A');
		expect(asciiCell(0x0a)).toBe('.');
		expect(asciiCell(0xc3)).toBe('.');
	});
});
