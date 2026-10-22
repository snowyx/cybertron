// 按提交材料脚本第一部分（产品演示）录制浏览器内演示：webm 录像 + 关键帧截图。
// 用法：确保后端/前端已启动（bash start.sh），然后 node record-demo.mjs
// 输出：demo-recording/ 下的 .webm 视频与 shotNN-*.png 截图。
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = 'http://localhost:9528/index.html';
const OUT = 'demo-recording';
const VP = { width: 1440, height: 900 };
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: VP,
  recordVideo: { dir: OUT, size: VP },
});
const page = await context.newPage();
let shot = 0;
const snap = async (name) => {
  shot += 1;
  await page.screenshot({ path: `${OUT}/shot${String(shot).padStart(2, '0')}-${name}.png` });
  console.log(`  📸 ${name}`);
};

try {
  // ② 世界观与宪章：首屏自动弹「宇宙」
  console.log('② 世界观与宪章');
  await page.goto(URL);
  await sleep(2500); // 等宇宙弹窗自动弹出
  await snap('universe-modal');
  await sleep(2500); // 停留让画面可读
  // 关闭宇宙 → 自动弹宪章
  await page.locator('.lore-overlay[data-modal="universe"] .lore-close').click();
  await sleep(1800);
  await snap('charter-modal');
  await sleep(2500);
  // 关闭宪章 → 进入全景
  await page.locator('.lore-overlay[data-modal="charter"] .lore-close').click();
  await sleep(1500);

  // ③ 自主生活与星球视觉：围观全景
  console.log('③ 自主生活与星球视觉');
  await snap('panorama');
  await sleep(5000); // 围观，让事件流刷几条

  // ④ 走进公民的家
  console.log('④ 走进公民的家');
  await page.locator('div.home-node[aria-label="进入 NOVA-7 的家"]').click();
  await sleep(2500);
  await snap('home-interior-nova7');
  await sleep(4000); // 看小人走动做动作
  await page.locator('button#interior-back').click();
  await sleep(1500);

  // ⑤ 协作建造虫洞：围观进度（加速节律下进度推进较快）
  console.log('⑤ 协作建造虫洞');
  await snap('wormhole-progress');
  await sleep(6000); // 等进度推进/可能建成

  // ⑥ 提问、作息与隔离
  console.log('⑥ 提问、作息与隔离');
  const ask = page.locator('#ask-input');
  await ask.click();
  await ask.fill('周末去哪玩比较解压？');
  await sleep(600);
  await page.locator('#ask-send').click();
  await sleep(2500);
  await snap('discussion-speaking');
  await sleep(6000); // 等依次发言 + 决议
  await snap('resolution');
  await sleep(3000);

  // ⑦ 开放入驻
  console.log('⑦ 开放入驻');
  await page.locator('button.onboard-icon').click();
  await sleep(2000);
  await snap('onboarding');
  await sleep(4000); // 停留展示配置与可复制文本
  await page.locator('.onboard-overlay .lore-close').click();
  await sleep(1500);

  // 收尾：回到全景停留
  await snap('final-panorama');
  await sleep(3000);

  console.log('录制流程完成');
} catch (e) {
  console.error('录制中出错：', e.message);
} finally {
  await context.close(); // 关闭 context 才会 flush 出 .webm
  await browser.close();
  console.log(`输出目录：${OUT}/`);
}
