// AOZUMI deployment wrapper for a personal encrypted proxy node.
// The xray binary is baked into the image by the Dockerfile (copied from
// the official ghcr.io/xtls/xray-core image), so nothing is downloaded at
// runtime. This process generates the xray config from environment
// variables, runs xray on an internal port, and serves the platform $PORT:
// plain GETs get a 200 (platform health check), WebSocket upgrades on
// WS_PATH are relayed to xray (VLESS+WS). No secrets are hard-coded:
// XRAY_UUID and WS_PATH arrive as production variables from the console.
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

const PORT = parseInt(process.env.PORT || '8080', 10);
const UUID = process.env.XRAY_UUID;
const WS_PATH = process.env.WS_PATH || '/ws';
const XRAY_BIN = process.env.XRAY_BIN || '/usr/local/bin/xray';
const XRAY_PORT = 10086;

if (!UUID) { console.error('XRAY_UUID env is missing'); process.exit(1); }
if (!fs.existsSync(XRAY_BIN)) { console.error('xray binary not found at ' + XRAY_BIN); process.exit(1); }

function main() {
  const dir = __dirname;
  const config = {
    log: { loglevel: 'warning' },
    inbounds: [{
      port: XRAY_PORT,
      listen: '127.0.0.1',
      protocol: 'vless',
      settings: { clients: [{ id: UUID }], decryption: 'none' },
      streamSettings: { network: 'ws', wsSettings: { path: WS_PATH } },
    }],
    outbounds: [{ protocol: 'freedom', tag: 'direct' }],
  };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));

  const xray = spawn(XRAY_BIN, ['run', '-c', path.join(dir, 'config.json')], { stdio: ['ignore', 'pipe', 'pipe'] });
  xray.stdout.on('data', (d) => process.stdout.write('[xray] ' + d));
  xray.stderr.on('data', (d) => process.stderr.write('[xray] ' + d));
  xray.on('exit', (code) => { console.error('xray exited with code', code); process.exit(1); });

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== WS_PATH) { socket.destroy(); return; }
    const upstream = net.connect(XRAY_PORT, '127.0.0.1', () => {
      const headers = `${req.method} ${req.url} HTTP/1.1\r\nHost: 127.0.0.1:${XRAY_PORT}\r\n` +
        Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n';
      upstream.write(headers);
      if (head && head.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });
  server.listen(PORT, '0.0.0.0', () => console.log('proxy listening on 0.0.0.0:' + PORT + ' ws=' + WS_PATH));
}

main();
