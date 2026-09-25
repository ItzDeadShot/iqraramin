/**
 * Builds a real Ethernet II / IPv4 / TCP frame whose payload is the bio,
 * and dissects bytes back into a Wireshark-style field tree. The two halves
 * are deliberately independent: the About page's tree is produced by
 * parsing the built bytes (including recomputing both checksums), not by
 * echoing the config, so the dissection is honest about what's on the wire.
 * No FCS: like most captures, the frame ends where the payload ends.
 */

export const TCP_FLAG_NAMES = ['CWR', 'ECE', 'URG', 'ACK', 'PSH', 'RST', 'SYN', 'FIN'] as const;
export type TcpFlag = (typeof TCP_FLAG_NAMES)[number];

export interface PacketConfig {
	ethernet: { src: string; dst: string };
	ipv4: { src: string; dst: string; ttl: number; identification: number; dscp: number; dontFragment: boolean };
	tcp: {
		srcPort: number;
		dstPort: number;
		seq: number;
		ack: number;
		flags: TcpFlag[];
		window: number;
		urgentPointer: number;
	};
}

export const ETH_HEADER = 14;
export const IPV4_HEADER = 20;
export const TCP_HEADER = 20;
export const PAYLOAD_OFFSET = ETH_HEADER + IPV4_HEADER + TCP_HEADER;
/** 1500-byte MTU minus the IPv4 and TCP headers (no options). */
export const MAX_PAYLOAD = 1500 - IPV4_HEADER - TCP_HEADER;

/** Paragraphs are separated by a blank line in the payload, like plain text. */
export function bioToPayloadText(paragraphs: string[]): string {
	return paragraphs.map((p) => p.trim()).join('\n\n');
}

/** RFC 1071 Internet checksum: one's-complement sum of 16-bit words. */
export function internetChecksum(...chunks: Uint8Array[]): number {
	let sum = 0;
	let odd: number | null = null;
	for (const chunk of chunks) {
		for (const byte of chunk) {
			if (odd === null) {
				odd = byte;
			} else {
				sum += (odd << 8) | byte;
				odd = null;
			}
		}
	}
	if (odd !== null) sum += odd << 8;
	while (sum > 0xffff) sum = (sum & 0xffff) + (sum >>> 16);
	return ~sum & 0xffff;
}

function parseMac(mac: string): number[] {
	const parts = mac.split(':');
	if (parts.length !== 6 || parts.some((p) => !/^[0-9a-f]{2}$/i.test(p))) throw new Error(`Invalid MAC address "${mac}"`);
	return parts.map((p) => parseInt(p, 16));
}

function parseIpv4(ip: string): number[] {
	const parts = ip.split('.');
	if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) {
		throw new Error(`Invalid IPv4 address "${ip}"`);
	}
	return parts.map(Number);
}

function pseudoHeader(src: Uint8Array, dst: Uint8Array, tcpLength: number): Uint8Array {
	const ph = new Uint8Array(12);
	ph.set(src, 0);
	ph.set(dst, 4);
	ph[9] = 6; // protocol: TCP
	ph[10] = tcpLength >> 8;
	ph[11] = tcpLength & 0xff;
	return ph;
}

export function buildPacket(config: PacketConfig, payloadText: string): Uint8Array {
	const payload = new TextEncoder().encode(payloadText);
	if (payload.length > MAX_PAYLOAD) {
		throw new Error(
			`Bio is ${payload.length} bytes as UTF-8, but one TCP segment in a 1500-byte MTU frame fits ${MAX_PAYLOAD}. Shorten the bio in src/content/data/about.yaml.`,
		);
	}
	const frame = new Uint8Array(PAYLOAD_OFFSET + payload.length);
	const view = new DataView(frame.buffer);

	// Ethernet II
	frame.set(parseMac(config.ethernet.dst), 0);
	frame.set(parseMac(config.ethernet.src), 6);
	view.setUint16(12, 0x0800); // EtherType: IPv4

	// IPv4
	const ip = ETH_HEADER;
	const ipSrc = Uint8Array.from(parseIpv4(config.ipv4.src));
	const ipDst = Uint8Array.from(parseIpv4(config.ipv4.dst));
	frame[ip] = (4 << 4) | (IPV4_HEADER / 4); // version 4, IHL 5
	frame[ip + 1] = (config.ipv4.dscp & 0x3f) << 2; // ECN: 0
	view.setUint16(ip + 2, IPV4_HEADER + TCP_HEADER + payload.length);
	view.setUint16(ip + 4, config.ipv4.identification);
	view.setUint16(ip + 6, config.ipv4.dontFragment ? 0x4000 : 0); // flags + fragment offset 0
	frame[ip + 8] = config.ipv4.ttl;
	frame[ip + 9] = 6; // protocol: TCP
	frame.set(ipSrc, ip + 12);
	frame.set(ipDst, ip + 16);
	view.setUint16(ip + 10, internetChecksum(frame.subarray(ip, ip + IPV4_HEADER)));

	// TCP
	const tcp = ETH_HEADER + IPV4_HEADER;
	view.setUint16(tcp, config.tcp.srcPort);
	view.setUint16(tcp + 2, config.tcp.dstPort);
	view.setUint32(tcp + 4, config.tcp.seq >>> 0);
	view.setUint32(tcp + 8, config.tcp.ack >>> 0);
	const flagBits = TCP_FLAG_NAMES.reduce((bits, name, i) => (config.tcp.flags.includes(name) ? bits | (0x80 >> i) : bits), 0);
	view.setUint16(tcp + 12, ((TCP_HEADER / 4) << 12) | flagBits); // data offset 5, reserved 0
	view.setUint16(tcp + 14, config.tcp.window);
	view.setUint16(tcp + 18, config.tcp.urgentPointer);
	frame.set(payload, PAYLOAD_OFFSET);
	const tcpSegment = frame.subarray(tcp);
	view.setUint16(tcp + 16, internetChecksum(pseudoHeader(ipSrc, ipDst, tcpSegment.length), tcpSegment));

	return frame;
}

// ---------------------------------------------------------------- dissect

export interface DissectedField {
	label: string;
	start: number;
	/** Exclusive. */
	end: number;
}

export interface DissectedLayer {
	id: 'frame' | 'eth' | 'ip' | 'tcp' | 'data';
	summary: string;
	start: number;
	end: number;
	fields: DissectedField[];
}

export interface Dissection {
	layers: DissectedLayer[];
	ethernet: { dst: string; src: string; type: number };
	ipv4: {
		version: number;
		ihl: number;
		dscp: number;
		totalLength: number;
		identification: number;
		dontFragment: boolean;
		moreFragments: boolean;
		fragmentOffset: number;
		ttl: number;
		protocol: number;
		checksum: number;
		checksumOk: boolean;
		src: string;
		dst: string;
	};
	tcp: {
		srcPort: number;
		dstPort: number;
		seq: number;
		ack: number;
		dataOffset: number;
		flags: TcpFlag[];
		window: number;
		checksum: number;
		checksumOk: boolean;
		urgentPointer: number;
	};
	payload: Uint8Array;
	payloadText: string;
}

const hex = (n: number, width: number) => `0x${n.toString(16).padStart(width, '0')}`;
const mac = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(':');
const ipv4 = (b: Uint8Array) => Array.from(b).join('.');
const bits = (byte: number) => byte.toString(2).padStart(8, '0');

export function dissect(frame: Uint8Array): Dissection {
	if (frame.length < PAYLOAD_OFFSET) throw new Error(`Frame too short: ${frame.length} bytes`);
	const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);

	const ethernet = { dst: mac(frame.subarray(0, 6)), src: mac(frame.subarray(6, 12)), type: view.getUint16(12) };
	if (ethernet.type !== 0x0800) throw new Error(`Not IPv4: EtherType ${hex(ethernet.type, 4)}`);

	const ip = ETH_HEADER;
	const flagsFrag = view.getUint16(ip + 6);
	const ihl = frame[ip] & 0x0f;
	if (ihl !== 5) throw new Error(`IPv4 options aren't supported (IHL ${ihl})`);
	const ipv4Parsed = {
		version: frame[ip] >> 4,
		ihl,
		dscp: frame[ip + 1] >> 2,
		totalLength: view.getUint16(ip + 2),
		identification: view.getUint16(ip + 4),
		dontFragment: (flagsFrag & 0x4000) !== 0,
		moreFragments: (flagsFrag & 0x2000) !== 0,
		fragmentOffset: flagsFrag & 0x1fff,
		ttl: frame[ip + 8],
		protocol: frame[ip + 9],
		checksum: view.getUint16(ip + 10),
		// Summing a header *including* its checksum yields 0 when it's valid.
		checksumOk: internetChecksum(frame.subarray(ip, ip + IPV4_HEADER)) === 0,
		src: ipv4(frame.subarray(ip + 12, ip + 16)),
		dst: ipv4(frame.subarray(ip + 16, ip + 20)),
	};
	if (ipv4Parsed.protocol !== 6) throw new Error(`Not TCP: protocol ${ipv4Parsed.protocol}`);

	const tcp = ETH_HEADER + IPV4_HEADER;
	const ipEnd = ETH_HEADER + ipv4Parsed.totalLength;
	const offsetFlags = view.getUint16(tcp + 12);
	const dataOffset = offsetFlags >> 12;
	if (dataOffset !== 5) throw new Error(`TCP options aren't supported (data offset ${dataOffset})`);
	const flagByte = offsetFlags & 0xff;
	const tcpSegment = frame.subarray(tcp, ipEnd);
	const tcpParsed = {
		srcPort: view.getUint16(tcp),
		dstPort: view.getUint16(tcp + 2),
		seq: view.getUint32(tcp + 4),
		ack: view.getUint32(tcp + 8),
		dataOffset,
		flags: TCP_FLAG_NAMES.filter((_, i) => (flagByte & (0x80 >> i)) !== 0),
		window: view.getUint16(tcp + 14),
		checksum: view.getUint16(tcp + 16),
		checksumOk:
			internetChecksum(
				pseudoHeader(frame.subarray(ip + 12, ip + 16), frame.subarray(ip + 16, ip + 20), tcpSegment.length),
				tcpSegment,
			) === 0,
		urgentPointer: view.getUint16(tcp + 18),
	};

	const payload = frame.subarray(PAYLOAD_OFFSET, ipEnd);
	const payloadText = new TextDecoder().decode(payload);
	const status = (ok: boolean) => (ok ? '[correct]' : '[incorrect]');
	// Wireshark lists set flags from the low bit up: "(PSH, ACK)".
	const flagSummary = tcpParsed.flags.length ? [...tcpParsed.flags].reverse().join(', ') : 'none';
	const preview = payloadText.replace(/\s+/g, ' ').slice(0, 48);

	const layers: DissectedLayer[] = [
		{
			id: 'frame',
			summary: `Frame: ${frame.length} bytes on wire (${frame.length * 8} bits)`,
			start: 0,
			end: frame.length,
			fields: [],
		},
		{
			id: 'eth',
			summary: `Ethernet II, Src: ${ethernet.src}, Dst: ${ethernet.dst}`,
			start: 0,
			end: ETH_HEADER,
			fields: [
				{ label: `Destination: ${ethernet.dst}`, start: 0, end: 6 },
				{ label: `Source: ${ethernet.src}`, start: 6, end: 12 },
				{ label: `Type: IPv4 (${hex(ethernet.type, 4)})`, start: 12, end: 14 },
			],
		},
		{
			id: 'ip',
			summary: `Internet Protocol Version 4, Src: ${ipv4Parsed.src}, Dst: ${ipv4Parsed.dst}`,
			start: ip,
			end: ip + IPV4_HEADER,
			fields: [
				{ label: `${bits(frame[ip]).slice(0, 4)} .... = Version: ${ipv4Parsed.version}`, start: ip, end: ip + 1 },
				{ label: `.... ${bits(frame[ip]).slice(4)} = Header Length: ${ihl * 4} bytes (${ihl})`, start: ip, end: ip + 1 },
				{ label: `Differentiated Services Field: ${hex(frame[ip + 1], 2)} (DSCP: ${ipv4Parsed.dscp})`, start: ip + 1, end: ip + 2 },
				{ label: `Total Length: ${ipv4Parsed.totalLength}`, start: ip + 2, end: ip + 4 },
				{ label: `Identification: ${hex(ipv4Parsed.identification, 4)} (${ipv4Parsed.identification})`, start: ip + 4, end: ip + 6 },
				{
					label: `Flags: ${hex(flagsFrag >> 13, 1)}${ipv4Parsed.dontFragment ? ", Don't fragment" : ''}${ipv4Parsed.moreFragments ? ', More fragments' : ''}`,
					start: ip + 6,
					end: ip + 8,
				},
				{ label: `Fragment Offset: ${ipv4Parsed.fragmentOffset}`, start: ip + 6, end: ip + 8 },
				{ label: `Time to Live: ${ipv4Parsed.ttl}`, start: ip + 8, end: ip + 9 },
				{ label: `Protocol: TCP (${ipv4Parsed.protocol})`, start: ip + 9, end: ip + 10 },
				{ label: `Header Checksum: ${hex(ipv4Parsed.checksum, 4)} ${status(ipv4Parsed.checksumOk)}`, start: ip + 10, end: ip + 12 },
				{ label: `Source Address: ${ipv4Parsed.src}`, start: ip + 12, end: ip + 16 },
				{ label: `Destination Address: ${ipv4Parsed.dst}`, start: ip + 16, end: ip + 20 },
			],
		},
		{
			id: 'tcp',
			summary: `Transmission Control Protocol, Src Port: ${tcpParsed.srcPort}, Dst Port: ${tcpParsed.dstPort}, Seq: ${tcpParsed.seq}, Ack: ${tcpParsed.ack}, Len: ${payload.length}`,
			start: tcp,
			end: PAYLOAD_OFFSET,
			fields: [
				{ label: `Source Port: ${tcpParsed.srcPort}`, start: tcp, end: tcp + 2 },
				{ label: `Destination Port: ${tcpParsed.dstPort}`, start: tcp + 2, end: tcp + 4 },
				{ label: `Sequence Number (raw): ${tcpParsed.seq}`, start: tcp + 4, end: tcp + 8 },
				{ label: `Acknowledgment Number (raw): ${tcpParsed.ack}`, start: tcp + 8, end: tcp + 12 },
				{ label: `${bits(frame[tcp + 12]).slice(0, 4)} .... = Header Length: ${dataOffset * 4} bytes (${dataOffset})`, start: tcp + 12, end: tcp + 13 },
				{ label: `Flags: ${hex(offsetFlags & 0x0fff, 3)} (${flagSummary})`, start: tcp + 12, end: tcp + 14 },
				{ label: `Window: ${tcpParsed.window}`, start: tcp + 14, end: tcp + 16 },
				{ label: `Checksum: ${hex(tcpParsed.checksum, 4)} ${status(tcpParsed.checksumOk)}`, start: tcp + 16, end: tcp + 18 },
				{ label: `Urgent Pointer: ${tcpParsed.urgentPointer}`, start: tcp + 18, end: tcp + 20 },
			],
		},
		{
			id: 'data',
			summary: `Data (${payload.length} bytes)`,
			start: PAYLOAD_OFFSET,
			end: ipEnd,
			fields: [
				{ label: `Data: ${preview}${payloadText.length > preview.length ? '...' : ''}`, start: PAYLOAD_OFFSET, end: ipEnd },
				{ label: `[Length: ${payload.length}]`, start: PAYLOAD_OFFSET, end: ipEnd },
			],
		},
	];

	return { layers, ethernet, ipv4: ipv4Parsed, tcp: tcpParsed, payload, payloadText };
}

/** Wireshark's ASCII column: printable ASCII as itself, anything else as ".". */
export function asciiCell(byte: number): string {
	return byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.';
}
