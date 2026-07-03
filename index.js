const puppeteer = require('puppeteer');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    console.log("🚀 开始初始化京东自动化任务 (详细日志版)...");

    const rawCookie = process.env.JD_COOKIE;
    if (!rawCookie) {
        console.error("❌ 严重错误：未找到 JD_COOKIE 环境变量！");
        process.exit(1);
    }

    const cookies = rawCookie.split(';').map(pair => {
        const [name, ...rest] = pair.trim().split('=');
        if (!name) return null;
        return { name: name.trim(), value: rest.join('=').trim(), domain: '.jd.com' };
    }).filter(c => c !== null);

    const browser = await puppeteer.launch({
        headless: true, 
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60000); 
    
    await page.setViewport({ width: 390, height: 844, isMobile: true });
    await page.setCookie(...cookies);
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1');

    console.log("🌐 正在打开京东互动页面...");
    try {
        await page.goto('https://interact.jd.com/', { waitUntil: 'networkidle2' });
    } catch (e) {
        console.log("⚠️ 页面网络请求超时，尝试继续执行...");
    }

    await page.waitForSelector('.lottery-box', { timeout: 15000 }).catch(() => {});
    await sleep(3000); 
    
    console.log("🤖 页面DOM已就绪，开始按顺序执行智能判定...");

    async function clickBtnByText(page, textList) {
        return await page.evaluate((texts) => {
            const elements = document.querySelectorAll('div, span, button');
            for (let el of elements) {
                const text = el.textContent.trim();
                if (el.children.length === 0 && texts.includes(text)) {
                    el.click();
                    return text; 
                }
            }
            return null;
        }, textList);
    }

    const signed = await page.evaluate(() => {
        const imgs = document.querySelectorAll('img');
        for (let img of imgs) {
            if (img.src && img.src.includes("84199557f1deec98.png")) {
                img.click();
                return true;
            }
        }
        return false;
    });
    if (signed) {
        console.log("✅ [初始动作] 找到“签到”图片，已点击。等待 3 秒...");
        await sleep(3000);
    }

    let hasClickedEarnMore = false;
    let safeCounter = 0; 

    // 核心循环开始
    while (true) {
        safeCounter++;
        console.log(`\n🔍 [状态机] 正在进行第 ${safeCounter} 次全局扫描...`);

        if (safeCounter > 100) {
            console.log("🛑 触发防死循环锁 (100次)，强制退出保存资源。");
            break;
        }

        // 优先级 1：弹窗
        const popupText = await clickBtnByText(page, ['开心收下', '收下', '我知道了', '继续抽', '去使用']);
        if (popupText) {
            console.log(`➡️ [命中 优先级1] 发现弹窗，已点击【${popupText}】，正在收下奖励...`);
            await sleep(2000);
            continue; 
        }

        // 优先级 2：面板
        if (!hasClickedEarnMore) {
            const earnMore = await clickBtnByText(page, ['赚更多京豆']);
            if (earnMore) {
                console.log("➡️ [命中 优先级2] 找到并点击了【赚更多京豆】，展开任务列表...");
                hasClickedEarnMore = true;
                await sleep(2000);
                continue;
            }
        }

        // 优先级 3：做任务
        const taskText = await clickBtnByText(page, ['去完成', '去浏览', '领取', '去领取', '去关注', '逛一逛']);
        if (taskText) {
            console.log(`➡️ [命中 优先级3] 发现可用任务【${taskText}】，已点击！`);
            console.log(`⏳ 正在死等 8 秒，模拟真人浏览时长...`);
            await sleep(8000); 

            const pages = await browser.pages();
            if (pages.length > 1) {
                console.log(`🧹 浏览完成！发现 ${pages.length - 1} 个多余的广告标签页，正在关闭...`);
                for (let i = 1; i < pages.length; i++) {
                    await pages[i].close();
                }
                await pages[0].bringToFront(); 
                await sleep(1500); 
            }
            continue; 
        }

        // 优先级 4：抽奖与退出
        const drawStatus = await page.evaluate(() => {
            const countDiv = document.querySelector('.lottery-count');
            if (countDiv && countDiv.textContent.replace(/\s+/g, '') === '剩余0次') {
                return 'empty'; 
            }
            return 'can_draw';
        });

        if (drawStatus === 'empty') {
            console.log("🎉 [命中 退出条件] 扫描发现所有任务已清空，且抽奖【剩余0次】！");
            console.log("🎉 今日任务全部圆满结束！");
            break; 
        }

        const drawClicked = await page.evaluate(() => {
            const drawBtn = document.querySelector('.pointer');
            if (drawBtn) {
                drawBtn.click();
                return true;
            }
            return false;
        });
        
        if (drawClicked) {
            console.log("➡️ [命中 优先级4] 当前无任务可做，已点击【立即开奖】！");
            console.log("⏳ 等待 6 秒开奖动画...");
            await sleep(6000); 
            continue; 
        }

        // 兜底
        console.log("💤 当前页面暂时未发现可点击的目标，等待 2 秒后刷新重试...");
        await sleep(2000);
    }

    console.log("✅ 浏览器资源清理中，即将安全关机。");
    await browser.close();
})();
