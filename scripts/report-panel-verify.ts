/**
 * Headed verification for the built panel. Serves scripts/harness plus dist/ on
 * 4321, mocks the two endpoints the panel talks to, then drives a real Chromium
 * through open, drag, describe, attach by drop, attach by file picker, attach by
 * a panel-wide paste, keyboard focus on the drop zone, and send.
 *
 *   npx playwright install chromium   # once
 *   npm run verify:panel
 *
 * This runs against dist/, not src/, so a broken build or a style.css that never
 * got copied fails here rather than in a consumer.
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const PORT = 4321;
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'docs/visual-smoke/2026-09-07-attachments-ux');

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' };

function serveFile(res: http.ServerResponse, file: string) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const p = url.pathname;

  if (p === '/mock/report' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      console.log('[mock] report payload:', body.slice(0, 400));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ref: 'REP-1', reportId: 'r-1', delivered: { db: true, reporter_copy: true } }));
    });
    return;
  }
  if (p === '/mock/attachment' && req.method === 'POST') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, attachment_id: 'a1', upload_url: `http://localhost:${PORT}/mock/put` }));
    return;
  }
  if (p === '/mock/put') {
    req.resume();
    req.on('end', () => res.writeHead(200).end(''));
    return;
  }

  if (p === '/favicon.ico') return void res.writeHead(204).end();
  if (p === '/' || p === '/index.html') return serveFile(res, path.join(ROOT, 'scripts/harness/index.html'));
  if (p.startsWith('/shim/')) return serveFile(res, path.join(ROOT, 'scripts/harness', p));
  if (p.startsWith('/dist/')) return serveFile(res, path.join(ROOT, p));
  res.writeHead(404).end('not found');
});

// A 1x1 PNG, dropped onto the panel to exercise the sign-then-PUT path.
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise<void>((r) => server.listen(PORT, r));

  const browser = await chromium.launch({ headless: false, slowMo: 400 });
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console error]', m.text()); });
  page.on('pageerror', (e) => console.log('[page error]', e.message));

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await page.getByTestId('harness-trigger').click();
  const panel = page.getByTestId('report-problem-panel');
  await panel.waitFor({ state: 'visible' });
  await page.waitForTimeout(800); // let the auto-capture settle

  // style.css applied? An unstyled panel is static, not fixed.
  const computed = await panel.evaluate((el) => {
    const s = getComputedStyle(el);
    return { position: s.position, borderRadius: s.borderRadius, boxShadow: s.boxShadow, fontFamily: s.fontFamily, zIndex: s.zIndex };
  });
  console.log('panel computed style:', JSON.stringify(computed));
  await page.screenshot({ path: path.join(OUT, 'open.png') });

  // Drag the panel by its handle. Up and right rather than down: dragged down
  // from centre the footer clears the viewport bottom and Send stops being
  // clickable, and a full 120 up puts the panel's top edge off-screen once the
  // success state collapses its height.
  const handle = page.getByTestId('report-drag-handle');
  const before = (await handle.boundingBox())!;
  await handle.hover(); // lands on the handle's centre, so drag from there
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 120, before.y + before.height / 2 - 80, { steps: 12 });
  await page.mouse.up();
  const after = (await handle.boundingBox())!;
  const moved = Math.abs(after.x - before.x) > 100 && Math.abs(after.y - before.y) > 60;
  console.log(`panel dragged: ${moved}`);
  await page.screenshot({ path: path.join(OUT, 'dragged.png') });

  await page.getByTestId('report-text').fill('The export button spins forever and never produces a file.');
  await page.locator('[data-testid="report-shot-zone"]').evaluate((el, b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'manual.png', { type: 'image/png' }));
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, TINY_PNG);
  const shots = page.locator('[data-testid="report-shot-zone"] .rap-shot');
  await shots.nth(0).waitFor({ state: 'visible' });

  // EXPERTTECH-243, cause 2: there was no file input at all, so a click on the
  // zone did nothing. Feed the hidden input the way the OS picker would.
  const picked = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rap-verify-')), 'picked-file.png');
  fs.writeFileSync(picked, Buffer.from(TINY_PNG, 'base64'));
  await page.getByTestId('report-file-input').setInputFiles(picked);
  await shots.nth(1).waitFor({ state: 'visible' });
  const pickerOk = (await shots.count()) === 2;
  console.log(`file picker attached: ${pickerOk}`);
  await page.screenshot({ path: path.join(OUT, 'picked.png') });

  // Cause 1: paste only worked inside the textarea. Move focus off it, then
  // fire the paste at the title so nothing editable is involved at all.
  await page.locator('.rap-title').click();
  const focusedTag = await page.evaluate((b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
    document.querySelector('.rap-title')!.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
    return document.activeElement?.tagName ?? 'NONE';
  }, TINY_PNG);
  console.log(`paste fired with focus on ${focusedTag}`);
  await shots.nth(2).waitFor({ state: 'visible' });
  const pasteOk = (await shots.count()) === 3;
  console.log(`panel-wide paste attached: ${pasteOk}`);
  await page.screenshot({ path: path.join(OUT, 'pasted.png') });

  // Cause 3: the zone is a button now, so it has to take keyboard focus and
  // show a ring when it does.
  // Tab count is not fixed: the auto-capture consent adds two buttons between
  // the textarea and the zone whenever html2canvas succeeded.
  const zone = page.locator('[data-testid="report-shot-zone"]');
  await page.getByTestId('report-text').focus();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    if (await zone.evaluate((el) => el === document.activeElement)) break;
  }
  const focus = await zone.evaluate((el) => {
    const s = getComputedStyle(el);
    return { focused: el === document.activeElement, visible: el.matches(':focus-visible'), outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth };
  });
  const focusOk = focus.focused && focus.visible && focus.outlineStyle === 'solid' && focus.outlineWidth !== '0px';
  const pasteOkText = focusedTag !== 'TEXTAREA';
  console.log(`drop zone focus ring: ${JSON.stringify(focus)}`);
  await page.screenshot({ path: path.join(OUT, 'focus-ring.png') });

  await page.getByTestId('report-send').click();
  await page.getByTestId('report-sent').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'sent.png') });

  const sentText = await page.getByTestId('report-sent').innerText();
  await browser.close();
  server.close();

  fs.rmSync(path.dirname(picked), { recursive: true, force: true });

  const refOk = sentText.includes('REP-1');
  const styledOk = computed.position === 'fixed' && computed.borderRadius !== '0px' && computed.boxShadow !== 'none';
  console.log(`refOk=${refOk} styledOk=${styledOk} moved=${moved} pickerOk=${pickerOk} pasteOk=${pasteOk} pasteOffTextarea=${pasteOkText} focusOk=${focusOk}`);
  console.log(`screenshots in ${path.relative(ROOT, OUT)}`);
  if (!(refOk && styledOk && moved && pickerOk && pasteOk && pasteOkText && focusOk)) {
    console.log('VERIFY FAIL');
    process.exit(1);
  }
  console.log('VERIFY OK');
}

main().catch((e) => { console.error(e); server.close(); process.exit(1); });
