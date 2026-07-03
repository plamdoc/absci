const puppeteer = require('puppeteer');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    console.log("🚀 [V9 终极胜利版] 开始初始化京东自动化任务...");

    const rawCookie = process.env.JD_COOKIE;
    if (!rawCookie) {
        console.error("❌ 未找到 JD_COOKIE，退出！");
        process.exit(1);
    }

    const cookies = rawCookie.split(';').map(pair => {
        const parts = pair.trim().split('=');
        if (parts.length < 2) return null;
        const name = parts[0].trim();
        const value = parts.slice(1).join('=').trim();
        if (!name || !value) return null;
        return { name, value, domain: '.jd.com', path: '/' };
    }).filter(c => c !== null);

    const browser = await puppeteer.launch({
        headless: true, 
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--disable-web-security'
        ]
    });

    try {
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(60000); 
        await page.setViewport({ width: 390, height: 844, isMobile: true });
        
        console.log(`🍪 成功注入 ${cookies.length} 个 Cookie 字段...`);
        await page.setCookie(...cookies);
        
        await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1');

        console.log("🌐 正在打开京东互动页面...");
        await page.goto('https://interact.jd.com/', { waitUntil: 'networkidle2' });
        await sleep(5000); 

        const currentUrl = await page.url();
        console.log(`📍 当前真实 URL: ${currentUrl}`);

        if (currentUrl.includes('login') || currentUrl.includes('plogin') || currentUrl.includes('passport')) {
            console.error("❌ 依然被拦截到登录页面，Cookie可能已失效！");
            await browser.close();
            process.exit(1);
        }

        console.log("🤖 页面成功绕过风控，开始执行全自动任务...");
        let safeCounter = 0; 
        let emptyRoundCount = 0;

        while (safeCounter < 60) {
            safeCounter++;
            console.log(`\n🔍 --- 第 ${safeCounter} 轮扫描 ---`);

            // ⭐ 终极停止条件检测：只要页面出现了“抽奖次数已用完”，直接完结撒花！
            const isFinished = await page.evaluate(() => {
                return document.body.innerText.includes('抽奖次数已用完');
            });
            if (isFinished) {
                console.log("🎉 扫描发现【抽奖次数已用完】弹窗，今日所有任务和抽奖彻底结束！");
                break;
            }

            const popupText = await page.evaluate(() => {
                const isVisible = (elem) => elem && elem.getBoundingClientRect().width > 0;
                
                // 优先点 X 关闭按钮，最安全，不会引起误触跳转
                const closeIcon = document.querySelector('.close-icon');
                if (isVisible(closeIcon)) { closeIcon.click(); return '关闭(图标)'; }
                
                const acceptBtn = document.querySelector('.accept');
                if (isVisible(acceptBtn)) { acceptBtn.click(); return '开心收下(类名)'; }
                
                // ⚠️ 移除了容易引起死循环的 '去使用' 和 '继续抽'
                const btns = Array.from(document.querySelectorAll('div, span, button'));
                const textBtn = btns.find(el => el.innerText && ['开心收下', '我知道了', '开心收下吧'].includes(el.innerText.trim()) && isVisible(el));
                
                if (textBtn) { textBtn.click(); return textBtn.innerText.trim(); }
                return null;
            });

            if (popupText) {
                console.log(`🎁 清理弹窗：【${popupText}】...`);
                emptyRoundCount = 0;
                await sleep(2000);
                continue; 
            }

            const taskInfo = await page.evaluate(() => {
                const isVisible = (elem) => elem && elem.getBoundingClientRect().width > 0;
                const preciseTask = document.querySelector('.common-btn.btn.undone');
                if (isVisible(preciseTask)) {
                    preciseTask.click(); return preciseTask.innerText.trim();
                }
                const btns = Array.from(document.querySelectorAll('div, span, button'));
                const textTask = btns.find(el => ['去完成', '去浏览', '去关注', '逛一逛'].includes(el.innerText ? el.innerText.trim() : '') && isVisible(el));
                if (textTask) {
                    textTask.click(); return textTask.innerText.trim();
                }
                return null;
            });

            if (taskInfo) {
                console.log(`🚀 执行任务：【${taskInfo}】！强制死等 8 秒...`);
                emptyRoundCount = 0;
                await sleep(8000); 
                const pages = await browser.pages();
                if (pages.length > 1) {
                    for (let i = 1; i < pages.length; i++) await pages[i].close();
                    await pages[0].bringToFront(); 
                    await sleep(1500);
                }
                continue; 
            }

            const drawState = await page.evaluate(() => {
                const countDiv = document.querySelector('.lottery-count');
                const pointerBtn = document.querySelector('.pointer');
                if (countDiv && countDiv.innerText.replace(/\s+/g, '') === '剩余0次') return 'EMPTY'; 
                if (pointerBtn && pointerBtn.getBoundingClientRect().width > 0) {
                    pointerBtn.click(); return 'CLICKED';
                }
                return 'NOT_FOUND';
            });

            if (drawState === 'EMPTY') {
                console.log("🎉 任务与抽奖已全部清空，今日圆满结束！");
                break; 
            } else if (drawState === 'CLICKED') {
                console.log("🎰 正在抽奖！等待 6 秒开奖...");
                emptyRoundCount = 0;
                await sleep(6000);
                continue;
            }

            emptyRoundCount++;
            console.log(`💤 暂未发现目标，等待 3 秒...`);
            await sleep(3000);
            
            // 防卡死兜底：如果卡住，点击边缘并滚动页面唤醒
            if (emptyRoundCount >= 4) {
                await page.mouse.click(10, 10);
                await page.evaluate(() => window.scrollBy(0, 300));
                emptyRoundCount = 0;
            }
        }
        console.log("✅ 自动化流程完美结束。");
    } catch (error) {
        console.error("❌ 发生报错:", error);
    } finally {
        await browser.close();
    }
})();
