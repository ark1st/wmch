import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';

const directory = path.resolve(fileURLToPath(new URL('../dist/lucky-draw/', import.meta.url)));
const prefix = '/wmch/lucky-draw/';
const port = Number(process.env.LUCKY_DRAW_PORT || 4748);
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
try { await stat(path.join(directory,'index.html')); }
catch { console.error('빌드 파일이 없습니다. site 폴더에서 빌드를 완료한 뒤 다시 실행해 주세요.'); process.exit(1); }
const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    const url = new URL(req.url,'http://localhost');
    if (url.pathname === '/' || url.pathname === prefix.slice(0,-1)) { res.writeHead(302,{Location:prefix}); res.end(); return; }
    if (!url.pathname.startsWith(prefix)) { res.writeHead(404); res.end(); return; }
    const suffix = decodeURIComponent(url.pathname.slice(prefix.length));
    let target = path.resolve(directory,suffix || 'index.html');
    if (!target.startsWith(directory + path.sep) && target !== directory) { res.writeHead(403); res.end(); return; }
    if ((await stat(target)).isDirectory()) target = path.join(target,'index.html');
    const contents = await readFile(target);
    res.writeHead(200, {'Content-Type':mime[path.extname(target)] || 'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
    res.end(req.method === 'HEAD' ? undefined : contents);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `이미 실행 중이거나 ${port} 포트가 사용 중입니다. http://localhost:${port}${prefix} 주소를 확인해 주세요.` : error.message);
  process.exitCode = 1;
});
server.listen(port,'127.0.0.1', () => {
  const url = `http://localhost:${port}${prefix}`;
  console.log(`세계선교교회 행운권 추첨\n${url}\n\n행사 중에는 이 창을 열어 두세요. 종료: Ctrl+C\n인터넷 연결 없이도 실행됩니다.`);
  if (process.argv.includes('--open') && process.platform === 'win32') {
    const child = spawn('cmd.exe',['/c','start','',url],{windowsHide:true,stdio:'ignore'});
    child.on('error', () => console.log('위 주소를 Chrome에서 열어 주세요.'));
  }
});
