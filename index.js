const puppeteer = require('puppeteer');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    console.log("🚀 [V10 暴力刷新版] 开始执行京东自动化任务...");

    const rawCookie = process.env.JD_COOKIE;
    if (!rawCookie) {
        console.error("❌ 未找到 JD_COOKIE，退出！");
        process.exit(1);
    }

    const cookies = rawCookie.split(';').map(pair => {
        const parts = pair.trim().split('=');
        if (parts.length < 2) return null;
        return { name: parts[0].trim(), value: parts.slice(1).join('=').trim(), domain: '.jd.com', path: '/' };
    }).filter(c => c !== null);

    const browser = await puppeteer.launch({
        headless: true, 
        args: [
            '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled', '--disable-web-security'
        ]
    });

    try {
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(60000); 
        await page.setViewport({ width: 390, height: 844, isMobile: true });
        await page.setCookie(...cookies);
        await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1');

        let loopCount = 0;

        // 核心死循环，最大执行 60 次
        while (loopCount < 60) {
            loopCount++;
            console.log(`\n🔄 === 第 ${loopCount} 轮扫描 ===`);

            try {
                // 1. 【按你说的】确保只有主页面，并且强行回到主活动页
                const pages = await browser.pages();
                if (pages.length > 1) {
                    for (let i = 1; i < pages.length; i++) await pages[i].close();
                    await pages[0].bringToFront();
                }

                const currentUrl = await page.url();
                if (!currentUrl.includes('interact.jd.com')) {
                    console.log("🌐 正在(重新)进入京东互动主页...");
                    await page.goto('https://interact.jd.com/', { waitUntil: 'domcontentloaded' }).catch(()=>{});
                    await sleep(4000); 
                }

                // 2. 检测终极结束标志
                const isFinished = await page.evaluate(() => document.body.innerText.includes('抽奖次数已用完'));
                if (isFinished) {
                    console.log("🎉 页面提示【抽奖次数已用完】，今日任务圆满收工！");
                    break;
                }

                // 3. 点掉所有弹窗
                const popup = await page.evaluate(() => {
                    const isVisible = (elem) => elem && elem.getBoundingClientRect().width > 0;
                    const close = document.querySelector('.close-icon');
                    if (isVisible(close)) { close.click(); return '关闭按钮'; }
                    const accept = document.querySelector('.accept');
                    if (isVisible(accept)) { accept.click(); return '开心收下'; }
                    return null;
                });
                if (popup) {
                    console.log(`🎁 点掉弹窗：${popup}，等待 2 秒...`);
                    await sleep(2000);
                    continue;
                }

                // 4. 【按你说的】直接找红色框框任务按钮
                const taskResult = await page.evaluate(() => {
                    // 直接找你截图中出现的 class="common-btn btn undone"
                    const btn = document.querySelector('.common-btn.btn.undone');
                    if (btn && btn.getBoundingClientRect().width > 0) {
                        const txt = btn.innerText.trim();
                        btn.click();
                        return txt;
                    }
                    return null;
                });

                if (taskResult) {
                    console.log(`🚀 点击红色任务框：【${taskResult}】！死等 8 秒...`);
                    await sleep(8000);
                    
                    // ⭐ 核心精髓：不管刚才点击后页面跳去了哪里，直接强制重新加载主页！
                    console.log("🔄 8秒结束，强制重新加载主页，消灭一切跳转！");
                    await page.goto('https://interact.jd.com/', { waitUntil: 'domcontentloaded' }).catch(()=>{});
                    await sleep(3000);
                    continue;
                }

                // 5. 如果看不到红框框，点开面板
                const panel = await page.evaluate(() => {
                    const btns = Array.from(document.querySelectorAll('div, span, button'));
                    const earnBtn = btns.find(el => el.innerText && el.innerText.trim() === '赚更多京豆' && el.getBoundingClientRect().width > 0);
                    if (earnBtn) { earnBtn.click(); return true; }
                    return false;
                });
                if (panel) {
                    console.log("💰 展开任务面板...");
                    await sleep(2000);
                    continue;
                }

                // 6. 去抽奖
                const drawResult = await page.evaluate(() => {
                    const pointer = document.querySelector('.pointer');
                    const count = document.querySelector('.lottery-count');
                    if (count && count.innerText.includes('0次')) return 'EMPTY';
                    if (pointer && pointer.getBoundingClientRect().width > 0) {
                        pointer.click();
                        return 'CLICKED';
                    }
                    return 'NOT_FOUND';
                });

                if (drawResult === 'EMPTY') {
                    console.log("🎉 剩余抽奖0次，结束！");
                    break;
                } else if (drawResult === 'CLICKED') {
                    console.log("🎰 点击抽奖！死等 6 秒开奖动画...");
                    await sleep(6000);
                    // 抽完奖也强制刷新，防止弹窗卡死
                    await page.goto('https://interact.jd.com/', { waitUntil: 'domcontentloaded' }).catch(()=>{});
                    await sleep(3000);
                    continue;
                }

                console.log("💤 没看到目标红框，等待 3 秒...");
                await sleep(3000);

            } catch (err) {
                // ⭐ 捕获一切报错（包括 Detached Frame）
                console.log(`⚠️ 页面发生跳转导致失去连接 (忽略此报错): ${err.message.split('\n')[0]}`);
                console.log("🔧 正在进行容错处理，即将强制刷新重置...");
                await sleep(2000);
                // 报错也没关系，循环会自动回到第 1 步，强行 goto 重开页面！
            }
        }
        console.log("✅ 自动化流程完美结束。");
    } catch (error) {
        console.error("❌ 严重报错:", error);
    } finally {
        await browser.close();
    }
})();
