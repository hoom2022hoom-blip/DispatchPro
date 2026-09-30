import { createSocket } from 'node:dgram';
import { appendFileSync } from 'node:fs';

export function formatPacket(packet, remote, localPort, timestamp = new Date().toISOString()) {
  let utf8Valid = true;
  try { new TextDecoder('utf-8', { fatal: true }).decode(packet); } catch { utf8Valid = false; }
  const ascii = [...packet].map(byte => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : `\\x${byte.toString(16).padStart(2, '0')}`).join('');
  return [
    '========== UDP PACKET ==========',
    `Timestamp: ${timestamp}`,
    `Source IP: ${remote.address}`,
    `Source Port: ${remote.port}`,
    'Capture method: UDP socket fallback',
    'Destination IP: unavailable from wildcard UDP socket (see NPCAP record)',
    `Destination Port: ${localPort}`,
    `Local Port: ${localPort}`,
    `Packet length: ${packet.length} bytes`,
    `HEX: ${packet.toString('hex').match(/.{2}/g)?.join(' ') ?? ''}`,
    `UTF-8 (${utf8Valid ? 'valid' : 'invalid sequences replaced; HEX is exact'}): ${JSON.stringify(packet.toString('utf8'))}`,
    `ASCII (non-printable/high bytes escaped): ${JSON.stringify(ascii)}`,
    '========== END PACKET ==========\n',
  ].join('\n');
}

export function listenRaw({ logFile, port = 3520, host = '0.0.0.0', output = console.log, onError = console.error, persist = true, onPacket = () => {} }) {
  const socket = createSocket('udp4');
  socket.on('message', (packet, remote) => {
    // Capture every datagram before any parsing. No source-IP or payload filter.
    const record = formatPacket(packet, remote, socket.address().port);
    output(record);
    try { if (persist) appendFileSync(logFile, record + '\n', 'utf8'); }
    catch (error) { onError(new Error(`RAW LOG WRITE FAILED: ${error.message}`)); }
    Promise.resolve().then(() => onPacket(packet, remote.address)).catch(onError);
  });
  socket.on('error', onError);
  socket.bind(port, host);
  return socket;
}
