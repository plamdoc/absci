const puppeteer = require('puppeteer');

// 强制等待函数
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    console.log("🚀 开始初始化jdtst (彻底修复版)...");

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
    page.setDefaultNavigationTimeout(60000); // 设置导航超时为60秒
    
    await page.setViewport({ width: 390, height: 844, isMobile: true });
    await page.setCookie(...cookies);
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1');

    console.log("🌐 正在打开京东互动页面...");
    try {
        await page.goto('https://interact.jd.com/', { waitUntil: 'networkidle2' });
    } catch (e) {
        console.log("⚠️ 页面加载完成，但部分资源超时，继续执行...");
    }

    console.log("🤖 开始按顺序执行任务...");

    // ================= 辅助函数：在页面内寻找并点击文字 =================
    async function clickBtnByText(page, textList) {
        return await page.evaluate((texts) => {
            const elements = document.querySelectorAll('div, span, button');
            for (let el of elements) {
                const text = el.textContent.trim();
                if (el.children.length === 0 && texts.includes(text)) {
                    el.click();
                    return text; // 返回被点击的文字
                }
            }
            return null;
        }, textList);
    }

    // ================= 第一步：尝试签到 =================
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

    // ================= 第二步：智能状态机循环 =================
    let hasClickedEarnMore = false;
    let safeCounter = 0; // 安全锁，防止死循环

    while (true) {
        safeCounter++;
        if (safeCounter > 80) {
            console.log("🛑 达到最大循环次数(80次)，强制安全退出。");
            break;
        }

        // 0. 检测是否彻底结束
        const isFinished = await page.evaluate(() => {
            if (document.body.innerText.includes('抽奖次数已用完，请明天再来')) return true;
            const countDiv = document.querySelector('.lottery-count');
            if (countDiv && countDiv.textContent.replace(/\s+/g, '') === '剩余0次') return true;
            return false;
        });

        if (isFinished) {
            console.log("🎉 任务已全部完成 (检测到抽奖次数为 0)！");
            break;
        }

        // 1. 处理弹窗
        const popupText = await clickBtnByText(page, ['开心收下', '收下', '我知道了']);
        if (popupText) {
            console.log(`🎁 发现弹窗，已点击【${popupText}】，等待 2 秒...`);
            await sleep(2000);
            continue;
        }

        // 2. 展开任务列表
        if (!hasClickedEarnMore) {
            const earnMore = await clickBtnByText(page, ['赚更多京豆']);
            if (earnMore) {
                console.log("💰 已点击【赚更多京豆】，展开任务列表，等待 2 秒...");
                hasClickedEarnMore = true;
                await sleep(2000);
                continue;
            }
        }

        // 3. 执行核心任务 (浏览/关注等)
        const taskText = await clickBtnByText(page, ['去完成', '去浏览', '领取', '去领取', '去关注', '逛一逛']);
        if (taskText) {
            console.log(`⏳ 发现任务【${taskText}】，已点击。强制等待 8 秒完成任务...`);
            await sleep(8000); // 必须等待8秒，满足“浏览6S”的要求

            // 核心修复点：关闭京东打开的所有多余标签页
            const pages = await browser.pages();
            if (pages.length > 1) {
                console.log(`🧹 清理垃圾标签页：发现 ${pages.length} 个标签页，正在关闭多余页面...`);
                for (let i = 1; i < pages.length; i++) {
                    await pages[i].close();
                }
                await pages[0].bringToFront(); // 焦点回到主页面
                await sleep(2000); // 缓冲一下
            }
            continue; // 继续下一轮循环
        }

        // 4. 开始抽奖
        const drawClicked = await page.evaluate(() => {
            const drawBtn = document.querySelector('.pointer');
            if (drawBtn) {
                drawBtn.click();
                return true;
            }
            return false;
        });
        
        if (drawClicked) {
            console.log("🎰 已点击【立即开奖】，等待抽奖动画 5 秒...");
            await sleep(5000); // 抽奖动画比较长，多等一会儿
            continue;
        }

        // 如果上面都没执行（比如页面还在渲染），休息 2 秒再找
        await sleep(2000);
    }

    console.log("✅ 今日自动化任务圆满结束，准备关机...");
    await browser.close();
})();
