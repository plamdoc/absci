const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const CONFIG = {
  HOME_URL: 'https://interact.jd.com/',
  MAX_LOOP: 30,
  MAX_TASKS: 6,
  TASK_WAIT_MIN: 8000,
  TASK_WAIT_MAX: 12000,
  PAGE_WAIT: 5000,
  DEBUG_DIR: path.join(__dirname, 'debug'),
};

function randomSleep(min, max) {
  return sleep(Math.floor(Math.random() * (max - min + 1)) + min);
}

function parseCookies(rawCookie) {
  return rawCookie
    .split(';')
    .map(item => {
      const parts = item.trim().split('=');
      if (parts.length < 2) return null;

      const name = parts.shift().trim();
      const value = parts.join('=').trim();

      if (!name || !value) return null;

      return {
        name,
        value,
        domain: '.jd.com',
        path: '/',
        httpOnly: false,
        secure: false,
      };
    })
    .filter(Boolean);
}

async function safeGoto(page, url, waitUntil = 'domcontentloaded') {
  try {
    console.log(`🌐 打开页面：${url}`);
    await page.goto(url, {
      waitUntil,
      timeout: 45000,
    });
    await sleep(CONFIG.PAGE_WAIT);
    return true;
  } catch (err) {
    console.log(`⚠️ 页面打开失败：${err.message}`);
    return false;
  }
}

async function saveDebug(page, loopCount) {
  try {
    if (!fs.existsSync(CONFIG.DEBUG_DIR)) {
      fs.mkdirSync(CONFIG.DEBUG_DIR, { recursive: true });
    }

    const htmlPath = path.join(CONFIG.DEBUG_DIR, `loop-${loopCount}.html`);
    const pngPath = path.join(CONFIG.DEBUG_DIR, `loop-${loopCount}.png`);

    const html = await page.content();
    fs.writeFileSync(htmlPath, html, 'utf8');

    await page.screenshot({
      path: pngPath,
      fullPage: true,
    });

    const text = await page.evaluate(() => {
      return document.body ? document.body.innerText.slice(0, 1200) : '';
    });

    console.log('🧩 页面文字片段：');
    console.log(text.replace(/\n+/g, '\n').slice(0, 1200));

    console.log(`🖼️ Debug 已保存：${htmlPath}`);
    console.log(`🖼️ Screenshot 已保存：${pngPath}`);
  } catch (err) {
    console.log(`⚠️ 保存 Debug 失败：${err.message}`);
  }
}

async function checkLogin(page) {
  try {
    const text = await page.evaluate(() => document.body ? document.body.innerText : '');
    if (/请登录|登录|账号登录|短信登录|验证码/.test(text)) {
      console.log('❌ 当前页面可能未登录，Cookie 可能失效。');
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

async function getVisibleTaskHandle(frame) {
  try {
    const handle = await frame.evaluateHandle(() => {
      const keywords = [
        '去浏览',
        '去关注',
        '去完成',
        '去逛逛',
        '去看看',
        '去会场',
        '立即前往',
        '做任务',
        '浏览',
        '关注',
        '完成'
      ];

      const ignoreWords = [
        '已完成',
        '已领取',
        '明日再来',
        '任务已完成',
        '领取成功'
      ];

      const selectors = [
        '.common-btn.btn.undone',
        '.common-btn.undone',
        '.btn.undone',
        '[class*="undone"]',
        '[class*="task"]',
        'button',
        'a',
        'div',
        'span'
      ];

      const nodes = [];

      for (const selector of selectors) {
        document.querySelectorAll(selector).forEach(el => nodes.push(el));
      }

      const uniqueNodes = Array.from(new Set(nodes));

      function isVisible(el) {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);

        return (
          rect.width > 20 &&
          rect.height > 10 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0'
        );
      }

      for (const el of uniqueNodes) {
        const text = (el.innerText || el.textContent || '').trim();

        if (!text) continue;
        if (!isVisible(el)) continue;
        if (ignoreWords.some(word => text.includes(word))) continue;

        const hit = keywords.some(word => text.includes(word));

        if (hit) {
          el.scrollIntoView({
            behavior: 'instant',
            block: 'center',
            inline: 'center'
          });

          return el;
        }
      }

      return null;
    });

    const element = handle.asElement();

    if (!element) {
      await handle.dispose();
      return null;
    }

    const text = await frame.evaluate(el => {
      return (el.innerText || el.textContent || '').trim();
    }, element).catch(() => '');

    return {
      element,
      text,
      frameUrl: frame.url(),
    };
  } catch {
    return null;
  }
}

async function clickTask(page, taskInfo) {
  try {
    console.log(`🚀 发现任务按钮：【${taskInfo.text}】`);
    console.log(`📦 所在 Frame：${taskInfo.frameUrl || '主页面'}`);

    const oldPages = await page.browser().pages();

    await taskInfo.element.click({
      delay: 80,
    });

    await randomSleep(CONFIG.TASK_WAIT_MIN, CONFIG.TASK_WAIT_MAX);

    const newPages = await page.browser().pages();

    for (const p of newPages) {
      if (!oldPages.includes(p) && p !== page) {
        console.log(`🆕 检测到新标签页：${p.url()}`);
        await sleep(4000);
        await p.close().catch(() => {});
      }
    }

    const currentUrl = page.url();
    console.log(`📍 当前页面：${currentUrl}`);

    if (!currentUrl.includes('interact.jd.com')) {
      console.log('↩️ 当前已离开任务页，返回任务首页...');
      await safeGoto(page, CONFIG.HOME_URL);
    } else {
      await page.reload({
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      }).catch(() => {});
      await sleep(4000);
    }

    return true;
  } catch (err) {
    console.log(`⚠️ 点击任务失败：${err.message}`);
    return false;
  } finally {
    try {
      await taskInfo.element.dispose();
    } catch {}
  }
}

async function scanAndClickTask(page) {
  const frames = page.frames();

  console.log(`🧭 当前共检测到 ${frames.length} 个 frame`);

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];

    try {
      const taskInfo = await getVisibleTaskHandle(frame);

      if (!taskInfo) continue;

      const clicked = await clickTask(page, taskInfo);

      if (clicked) return true;
    } catch (err) {
      console.log(`⚠️ Frame ${i + 1} 扫描失败：${err.message}`);
    }
  }

  return false;
}

(async () => {
  console.log('🚀 [JD Puppeteer 稳定版] 正在启动...');

  const rawCookie = process.env.JD_COOKIE;

  if (!rawCookie) {
    console.error('❌ 缺少环境变量 JD_COOKIE');
    process.exit(1);
  }

  const cookies = parseCookies(rawCookie);

  if (!cookies.length) {
    console.error('❌ Cookie 解析失败，请检查 JD_COOKIE 格式');
    process.exit(1);
  }

  console.log(`🍪 已解析 Cookie 数量：${cookies.length}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=390,844'
    ],
  });

  try {
    const page = await browser.newPage();

    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(45000);

    await page.setViewport({
      width: 390,
      height: 844,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
    });

    await page.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
    );

    await page.setExtraHTTPHeaders({
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'referer': 'https://interact.jd.com/',
    });

    page.on('dialog', async dialog => {
      console.log(`⚠️ 页面弹窗：${dialog.message()}`);
      await dialog.dismiss().catch(() => {});
    });

    page.on('console', msg => {
      const text = msg.text();
      if (text && !text.includes('Failed to load resource')) {
        console.log(`📄 页面日志：${text.slice(0, 300)}`);
      }
    });

    await page.setCookie(...cookies);

    const opened = await safeGoto(page, CONFIG.HOME_URL, 'networkidle2');

    if (!opened) {
      console.log('⚠️ networkidle2 打开失败，尝试 domcontentloaded...');
      await safeGoto(page, CONFIG.HOME_URL, 'domcontentloaded');
    }

    const loginOk = await checkLogin(page);

    if (!loginOk) {
      await saveDebug(page, 'login-failed');
      console.log('❌ Cookie 已失效或未正确注入，请重新复制 JD Cookie。');
      return;
    }

    let loopCount = 0;
    let taskCount = 0;

    while (loopCount < CONFIG.MAX_LOOP && taskCount < CONFIG.MAX_TASKS) {
      loopCount++;

      console.log(`\n🔍 === 第 ${loopCount} 轮扫描，已完成 ${taskCount}/${CONFIG.MAX_TASKS} ===`);

      const stillLogin = await checkLogin(page);

      if (!stillLogin) {
        await saveDebug(page, `login-expired-${loopCount}`);
        console.log('❌ 扫描过程中检测到登录失效，停止运行。');
        break;
      }

      const foundAndClicked = await scanAndClickTask(page);

      if (foundAndClicked) {
        taskCount++;
        console.log(`✅ 已点击任务 ${taskCount}/${CONFIG.MAX_TASKS}`);
        await sleep(4000);
        continue;
      }

      console.log('💤 当前页面未发现可点击任务。');

      if (loopCount % 3 === 0) {
        await saveDebug(page, loopCount);
      }

      if (loopCount % 5 === 0) {
        console.log('🔄 多轮未发现任务，刷新任务首页...');
        await safeGoto(page, CONFIG.HOME_URL, 'domcontentloaded');
      } else {
        await sleep(3000);
      }
    }

    console.log('\n🎉 运行结束');
    console.log(`📊 总扫描轮数：${loopCount}`);
    console.log(`📊 点击任务数：${taskCount}`);
  } catch (error) {
    console.error('❌ 主程序错误：', error);
  } finally {
    await browser.close();
    console.log('👋 浏览器已关闭');
  }
})();
