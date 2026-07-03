const puppeteer = require('puppeteer');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    console.log("🚀 [V8 排错版] 开始初始化京东自动化任务...");

    const rawCookie = process.env.JD_COOKIE;
    if (!rawCookie) {
        console.error("❌ 未找到 JD_COOKIE，退出！");
        process.exit(1);
    }

    // ⭐ 增强版 Cookie 解析：能够处理非常长、不规范的完整抓包 Cookie
    const cookies = rawCookie.split(';').map(pair => {
        const parts = pair.trim().split('=');
        if (parts.length < 2) return null;
        const name = parts[0].trim();
        const value = parts.slice(1).join('=').trim(); // 防止 value 里也有等号
        if (!name || !value) return null;
        return { name, value, domain: '.jd.com', path: '/' };
    }).filter(c => c !== null);

    const browser = await puppeteer.launch({
        headless: true, 
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled', // 隐藏自动化特征
            '--disable-web-security'
        ]
    });

    try {
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(60000); 
        await page.setViewport({ width: 390, height: 844, isMobile: true });
        
        console.log(`🍪 成功解析并注入 ${cookies.length} 个 Cookie 字段...`);
        await page.setCookie(...cookies);
        
        await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1');

        console.log("🌐 正在打开京东互动页面...");
        await page.goto('https://interact.jd.com/', { waitUntil: 'networkidle2' });
        await sleep(5000); 

        // ⭐ 强化版拦截检测与现场取证
        const currentUrl = await page.url();
        const pageTitle = await page.title();
        console.log(`📍 当前真实 URL: ${currentUrl}`);
        console.log(`🏷️ 当前页面标题: ${pageTitle}`);

        if (currentUrl.includes('login') || currentUrl.includes('plogin') || currentUrl.includes('passport')) {
            console.error("❌ 致命错误：依然被拦截到登录页面！");
            
            // 抓取页面上的一些关键提示文字，看看到底是密码错误还是环境异常
            const pageText = await page.evaluate(() => document.body.innerText.substring(0, 200).replace(/\n/g, ' '));
            console.log(`🕵️ 登录页文字取证: ${pageText}`);
            
            console.error("💡 诊断结论：这是 GitHub Actions 服务器 IP 被京东严重风控导致的，Cookie 一上去就被销毁了。");
            await browser.close();
            process.exit(1);
        }

        console.log("🤖 页面成功绕过风控，开始扫描任务...");
        let safeCounter = 0; 
        let emptyRoundCount = 0;

        while (safeCounter < 60) {
            safeCounter++;
            console.log(`\n🔍 --- 第 ${safeCounter} 轮扫描 ---`);

            const popupText = await page.evaluate(() => {
                const isVisible = (elem) => elem && elem.getBoundingClientRect().width > 0;
                const acceptBtn = document.querySelector('.accept');
                if (isVisible(acceptBtn)) { acceptBtn.click(); return '开心收下(类名)'; }
                const closeIcon = document.querySelector('.close-icon');
                if (isVisible(closeIcon)) { closeIcon.click(); return '关闭(图标)'; }
                const btns = Array.from(document.querySelectorAll('div, span, button'));
                const textBtn = btns.find(el => el.innerText && ['开心收下', '我知道了', '去使用', '继续抽'].includes(el.innerText.trim()) && isVisible(el));
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
                console.log(`🚀 执行任务：【${taskInfo}】！等待 8 秒...`);
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
                console.log("🎰 正在抽奖！等待 6 秒...");
                emptyRoundCount = 0;
                await sleep(6000);
                continue;
            }

            emptyRoundCount++;
            console.log(`💤 暂未发现目标，等待 3 秒...`);
            await sleep(3000);
            if (emptyRoundCount >= 5) {
                await page.mouse.click(10, 10);
                await page.evaluate(() => window.scrollBy(0, 300));
                emptyRoundCount = 0;
            }
        }
        console.log("✅ 流程结束。");
    } catch (error) {
        console.error("❌ 发生报错:", error);
    } finally {
        await browser.close();
    }
})();
