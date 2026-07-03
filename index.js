const puppeteer = require('puppeteer');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    console.log("🚀 [V11 毁灭重生版] 开始执行京东自动化任务...");

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

    // ⭐ 核心绝招：创建一个全新的干净页面（彻底解决页面跳转导致的报错）
    async function createFreshPage() {
        const pages = await browser.pages();
        // 关掉所有旧页面
        for (let p of pages) {
            await p.close().catch(() => {});
        }
        const newPage = await browser.newPage();
        await newPage.setDefaultNavigationTimeout(60000); 
        await newPage.setViewport({ width: 390, height: 844, isMobile: true });
        await newPage.setCookie(...cookies);
        await newPage.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1');
        return newPage;
    }

    try {
        let page = await createFreshPage();
        console.log("🌐 正在首次进入京东互动主页...");
        await page.goto('https://interact.jd.com/', { waitUntil: 'domcontentloaded' }).catch(()=>{});
        await sleep(5000); 

        let loopCount = 0;

        while (loopCount < 60) {
            loopCount++;
            console.log(`\n🔄 === 第 ${loopCount} 轮扫描 ===`);

            try {
                // 1. 检测结束标志
                const isFinished = await page.evaluate(() => document.body.innerText.includes('抽奖次数已用完'));
                if (isFinished) {
                    console.log("🎉 页面提示【抽奖次数已用完】，今日任务圆满收工！");
                    break;
                }

                // 2. 点掉所有可见弹窗
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

                // 3. 【按你的思路】直接找红色框框，点完就跑
                const taskResult = await page.evaluate(() => {
                    const btn = document.querySelector('.common-btn.btn.undone');
                    if (btn && btn.getBoundingClientRect().width > 0) {
                        const txt = btn.innerText.trim();
                        btn.click();
                        return txt;
                    }
                    return null;
                });

                if (taskResult) {
                    console.log(`🚀 成功点击红框任务：【${taskResult}】！死等 8 秒...`);
                    await sleep(8000);
                    
                    // ⭐ 绝杀：不管页面跳转去哪了，直接销毁当前页面，重新建一个全新的打开主页！
                    console.log("🔥 任务完成！为防止跳转报错，正在销毁并重新打开页面...");
                    page = await createFreshPage();
                    await page.goto('https://interact.jd.com/', { waitUntil: 'domcontentloaded' }).catch(()=>{});
                    await sleep(5000);
                    continue;
                }

                // 4. 找面板按钮展开
                const panel = await page.evaluate(() => {
                    const earnBtn = Array.from(document.querySelectorAll('div, span, button')).find(el => el.innerText && el.innerText.trim() === '赚更多京豆' && el.getBoundingClientRect().width > 0);
                    if (earnBtn) { earnBtn.click(); return true; }
                    return false;
                });
                if (panel) {
                    console.log("💰 展开任务面板...");
                    await sleep(2000);
                    continue;
                }

                // 5. 点击抽奖
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
                    console.log("🎉 剩余抽奖0次，今日结束！");
                    break;
                } else if (drawResult === 'CLICKED') {
                    console.log("🎰 点击抽奖！等待 6 秒...");
                    await sleep(6000);
                    console.log("🔥 抽完奖！为防止意外卡死，正在销毁并重新打开页面...");
                    page = await createFreshPage();
                    await page.goto('https://interact.jd.com/', { waitUntil: 'domcontentloaded' }).catch(()=>{});
                    await sleep(5000);
                    continue;
                }

                console.log("💤 没看到目标红框，等待 3 秒...");
                await sleep(3000);

            } catch (err) {
                // ⭐ 终极防具：如果遇到任何意料之外的报错（比如网络断了一下，或者元素没找到）
                console.log(`⚠️ 捕获到底层异常跳出: ${err.message.split('\n')[0]}`);
                console.log("🔧 触发终极防御机制：直接销毁当前整个页面并重生！");
                page = await createFreshPage();
                await page.goto('https://interact.jd.com/', { waitUntil: 'domcontentloaded' }).catch(()=>{});
                await sleep(5000);
            }
        }
        console.log("✅ 自动化流程完美结束。");
    } catch (error) {
        console.error("❌ 严重报错:", error);
    } finally {
        await browser.close();
    }
})();
