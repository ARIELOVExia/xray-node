// Runtime wrapper: downloads official xray-core at runtime, runs VLESS+XHTTP
// (packet-up) on an internal port, and serves the platform $PORT with a tiny
// proxy that answers health checks (200 on /), relays plain HTTP requests on
// WS_PATH to xray (XHTTP), and relays WebSocket upgrades on WS_PATH to xray.
// WS was tried first (2026-11-08): the AOZUMI/Cloudflare gateway hung every
// WS upgrade with no 101 and no server-side trace, so XHTTP packet-up —
// designed to pass through such gateways — is the transport now.
// No secrets are hard-coded: UUID and WS_PATH arrive as env vars.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const https = require('https');
const http = require('http');
const net = require('net');
const path = require('path');

const PORT = parseInt(process.env.PORT || '8080', 10);
const UUID = process.env.XRAY_UUID;
const WS_PATH = process.env.WS_PATH || '/ws';
const XRAY_PORT = 10086;

if (!UUID) { console.error('XRAY_UUID env is missing'); process.exit(1); }

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'ample-xray-wrapper' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return getJson(res.headers.location).then(resolve, reject);
      }
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, { headers: { 'User-Agent': 'ample-xray-wrapper' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error('download HTTP ' + res.statusCode));
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', reject);
  });
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) return reject(new Error(cmd + ' failed: ' + (stderr || err.message)));
      resolve(stdout);
    });
  });
}

async function main() {
  const dir = __dirname;
  const xrayBin = path.join(dir, 'xray');
  if (!fs.existsSync(xrayBin)) {
    console.log('fetching latest xray-core release info...');
    const rel = await getJson('https://api.github.com/repos/XTLS/Xray-core/releases/latest');
    const tag = rel.tag_name;
    const url = `https://github.com/XTLS/Xray-core/releases/download/${tag}/Xray-linux-64.zip`;
    console.log('downloading', url);
    const zip = path.join(dir, 'xray.zip');
    await download(url, zip);
    try {
      await run('unzip', ['-o', zip, 'xray', '-d', dir]);
    } catch (e) {
      console.log('unzip not available, trying python3 zipfile');
      await run('python3', ['-c', `import zipfile; zipfile.ZipFile(${JSON.stringify(zip)}).extract('xray', ${JSON.stringify(dir)})`]);
    }
    fs.chmodSync(xrayBin, 0o755);
    fs.unlinkSync(zip);
    console.log('xray ready:', tag);
  }

  const config = {
    log: { loglevel: 'warning' },
    inbounds: [{
      port: XRAY_PORT,
      listen: '127.0.0.1',
      protocol: 'vless',
      settings: { clients: [{ id: UUID }], decryption: 'none' },
      streamSettings: { network: 'xhttp', xhttpSettings: { path: WS_PATH, mode: 'packet-up' } },
    }],
    outbounds: [{ protocol: 'freedom', tag: 'direct' }],
  };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));

  const xray = spawn(xrayBin, ['run', '-c', path.join(dir, 'config.json')], { stdio: ['ignore', 'pipe', 'pipe'] });
  xray.stdout.on('data', (d) => process.stdout.write('[xray] ' + d));
  xray.stderr.on('data', (d) => process.stderr.write('[xray] ' + d));
  xray.on('exit', (code) => { console.error('xray exited with code', code); process.exit(1); });

  const server = http.createServer((req, res) => {
    // XHTTP clients request {WS_PATH}/{session-uuid} (and the upload POST
    // uses the same pattern), so match by prefix, not exact path.
    if (req.url === WS_PATH || req.url.startsWith(WS_PATH + '/')) {
      // XHTTP: forward the plain HTTP request (GET download stream / POST upload) to xray.
      console.log('[xhttp] ' + req.method + ' ' + req.url);
      const headers = { ...req.headers };
      delete headers.host;
      const upstream = http.request(
        { host: '127.0.0.1', port: XRAY_PORT, path: req.url, method: req.method, headers },
        (upRes) => {
          console.log('[xhttp] upstream ' + upRes.statusCode + ' for ' + req.method + ' ' + req.url);
          res.writeHead(upRes.statusCode, upRes.headers);
          upRes.pipe(res);
        }
      );
      upstream.on('error', (e) => {
        console.log('[xhttp] upstream error: ' + e.message);
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });
  server.on('upgrade', (req, socket, head) => {
    console.log('[ws] upgrade ' + req.url);
    if (!(req.url === WS_PATH || req.url.startsWith(WS_PATH + '/'))) { console.log('[ws] path mismatch, destroy'); socket.destroy(); return; }
    const upstream = net.connect(XRAY_PORT, '127.0.0.1', () => {
      console.log('[ws] upstream connected');
      const headers = `${req.method} ${req.url} HTTP/1.1\r\nHost: 127.0.0.1:${XRAY_PORT}\r\n` +
        Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n';
      upstream.write(headers);
      if (head && head.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    upstream.on('error', (e) => { console.log('[ws] upstream error: ' + e.message); socket.destroy(); });
    socket.on('error', () => upstream.destroy());
  });
  server.listen(PORT, '0.0.0.0', () => console.log('proxy listening on 0.0.0.0:' + PORT + ' ws=' + WS_PATH));
}

main().catch((e) => { console.error('startup failed:', e); process.exit(1); });
