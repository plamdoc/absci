const puppeteer = require('puppeteer');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    console.log("🚀 开始初始化京东自动化任务 (逻辑重构版)...");

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
        console.log("⚠️ 页面加载完成，部分资源网络请求超时，继续执行...");
    }

    // 关键修复：强行等待核心宝箱模块渲染出来，防止页面还没加载完脚本就开始乱点
    await page.waitForSelector('.lottery-box', { timeout: 15000 }).catch(() => {});
    await sleep(3000); // 额外给页面动态渲染一点时间
    
    console.log("🤖 页面DOM已就绪，开始按顺序执行智能判定...");

    // ================= 辅助函数：点击匹配的文字按钮 =================
    async function clickBtnByText(page, textList) {
        return await page.evaluate((texts) => {
            const elements = document.querySelectorAll('div, span, button');
            for (let el of elements) {
                const text = el.textContent.trim();
                // 确保是底层节点，且包含目标文字
                if (el.children.length === 0 && texts.includes(text)) {
                    el.click();
                    return text; 
                }
            }
            return null;
        }, textList);
    }

    // ================= 1. 执行初始签到 =================
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
        console.log("✅ 找到“签到”图片，已点击。等待 3 秒...");
        await sleep(3000);
    }

    // ================= 2. 状态机大循环 =================
    let hasClickedEarnMore = false;
    let safeCounter = 0; 

    while (true) {
        safeCounter++;
        if (safeCounter > 100) {
            console.log("🛑 触发防死循环锁 (100次)，强制退出保存资源。");
            break;
        }

        // 优先级 1：不管干嘛，只要有弹窗先收下
        const popupText = await clickBtnByText(page, ['开心收下', '收下', '我知道了', '继续抽', '去使用']);
        if (popupText) {
            console.log(`🎁 收下奖励，已点击【${popupText}】...`);
            await sleep(2000);
            continue; 
        }

        // 优先级 2：点开赚京豆面板
        if (!hasClickedEarnMore) {
            const earnMore = await clickBtnByText(page, ['赚更多京豆']);
            if (earnMore) {
                console.log("💰 已展开任务列表...");
                hasClickedEarnMore = true;
                await sleep(2000);
                continue;
            }
        }

        // 优先级 3：扫描并执行任务
        const taskText = await clickBtnByText(page, ['去完成', '去浏览', '领取', '去领取', '去关注', '逛一逛']);
        if (taskText) {
            console.log(`⏳ 正在执行任务【${taskText}】，强制等待 8 秒...`);
            await sleep(8000); // 必须等8秒

            // 清理多余标签页
            const pages = await browser.pages();
            if (pages.length > 1) {
                for (let i = 1; i < pages.length; i++) {
                    await pages[i].close();
                }
                await pages[0].bringToFront(); 
                await sleep(1500); 
            }
            continue; // 做完一个任务，重头开始下一轮扫描
        }

        // 优先级 4：走到这里，说明【没弹窗】+【没任务】。这时候去检查抽奖！
        const drawStatus = await page.evaluate(() => {
            const countDiv = document.querySelector('.lottery-count');
            if (countDiv && countDiv.textContent.replace(/\s+/g, '') === '剩余0次') {
                return 'empty'; 
            }
            return 'can_draw';
        });

        // 如果明确显示剩余0次了，说明羊毛已经彻底薅干了
        if (drawStatus === 'empty') {
            console.log("🎉 所有任务已清空，且抽奖次数为 0，今日任务彻底结束！");
            break; // 真正跳出循环，结束脚本
        }

        // 如果不是 0 次，就尝试去点抽奖按钮
        const drawClicked = await page.evaluate(() => {
            const drawBtn = document.querySelector('.pointer');
            if (drawBtn) {
                drawBtn.click();
                return true;
            }
            return false;
        });
        
        if (drawClicked) {
            console.log("🎰 已点击【立即开奖】，等待 6 秒开奖动画...");
            await sleep(6000); 
            continue; // 抽完奖，重头开始循环（回去处理开奖弹窗）
        }

        // 如果页面卡顿什么都没找到，休息 2 秒再找
        await sleep(2000);
    }

    console.log("✅ 浏览器资源清理中，任务圆满收工。");
    await browser.close();
})();
