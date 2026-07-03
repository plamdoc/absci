const puppeteer = require('puppeteer');

// 强制等待函数
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    console.log("🚀 [究极版] 开始初始化京东自动化任务...");

    // 1. 检查环境变量
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

    // 2. 启动浏览器
    const browser = await puppeteer.launch({
        headless: true, 
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    try {
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(60000); 
        await page.setViewport({ width: 390, height: 844, isMobile: true });
        await page.setCookie(...cookies);
        // 伪装成真实的 iPhone
        await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1');

        console.log("🌐 正在打开京东互动页面...");
        await page.goto('https://interact.jd.com/', { waitUntil: 'domcontentloaded' });
        await sleep(4000); // 强行等待 4 秒，让 Vue/React 框架把 DOM 渲染出来

        // 🚨 核心排错点：检测 Cookie 是否过期被强制跳转登录页
        const currentUrl = await page.url();
        console.log(`📍 当前浏览器实际停留的 URL: ${currentUrl}`);
        if (currentUrl.includes('login') || currentUrl.includes('plogin')) {
            console.error("❌ 致命错误：你的 JD_COOKIE 已失效或过期，被京东拦截跳转到了登录界面！");
            console.error("💡 解决方案：请重新抓取最新的 Cookie，并更新到 GitHub Secrets 中。");
            await browser.close();
            process.exit(1);
        }

        console.log("🤖 页面验证通过，开始扫描并执行任务...");

        let safeCounter = 0; 
        let hasClickedEarnMore = false;

        // 3. 核心大循环
        while (safeCounter < 60) { // 最多循环 60 次
            safeCounter++;
            console.log(`\n🔍 --- 正在进行第 ${safeCounter} 轮扫描 ---`);

            // ⭐ 动作 1：处理弹窗 (签到成功、抽奖成功等)
            const popupHandled = await page.evaluate(() => {
                const acceptBtn = document.querySelector('.accept, .close-icon'); // 基于你之前的截图
                if (acceptBtn) {
                    acceptBtn.click();
                    return true;
                }
                // 备用文本匹配
                const btns = Array.from(document.querySelectorAll('div, span, button'));
                const textBtn = btns.find(el => el.innerText && ['开心收下', '我知道了', '去使用', '继续抽'].includes(el.innerText.trim()));
                if (textBtn) {
                    textBtn.click();
                    return true;
                }
                return false;
            });

            if (popupHandled) {
                console.log("🎁 发现弹窗并已自动收下奖励，等待 2 秒...");
                await sleep(2000);
                continue; 
            }

            // ⭐ 动作 2：展开“赚更多京豆”面板
            if (!hasClickedEarnMore) {
                const earnMoreHandled = await page.evaluate(() => {
                    const btns = Array.from(document.querySelectorAll('div, span, button'));
                    const btn = btns.find(el => el.innerText && el.innerText.trim() === '赚更多京豆');
                    if (btn) {
                        btn.click();
                        return true;
                    }
                    return false;
                });
                if (earnMoreHandled) {
                    console.log("💰 已点击【赚更多京豆】，展开任务列表...");
                    hasClickedEarnMore = true;
                    await sleep(2000);
                    continue;
                }
            }

            // ⭐ 动作 3：做任务 (直接使用你截图里发现的精确类名)
            const taskText = await page.evaluate(() => {
                // 精准定位类名为 common-btn btn undone 的按钮
                const taskBtn = document.querySelector('.common-btn.btn.undone');
                if (taskBtn) {
                    const text = taskBtn.innerText.trim();
                    taskBtn.click();
                    return text; // 返回按钮上的文字（比如“去浏览”）
                }
                return null;
            });

            if (taskText) {
                console.log(`🚀 发现待办任务【${taskText}】，已点击！强制等待 8 秒完成任务...`);
                await sleep(8000); // 雷打不动的 8 秒，满足浏览需求

                // 清理多余标签页
                const pages = await browser.pages();
                if (pages.length > 1) {
                    console.log(`🧹 任务完成，正在关闭 ${pages.length - 1} 个多余的广告跳转页...`);
                    for (let i = 1; i < pages.length; i++) {
                        await pages[i].close();
                    }
                    await pages[0].bringToFront(); 
                    await sleep(1500);
                }
                continue; 
            }

            // ⭐ 动作 4：抽奖判定
            const drawState = await page.evaluate(() => {
                const countDiv = document.querySelector('.lottery-count');
                const pointerBtn = document.querySelector('.pointer');
                
                // 判断次数是否耗尽
                if (countDiv && countDiv.innerText.replace(/\s+/g, '') === '剩余0次') {
                    return 'EMPTY'; 
                }
                // 尝试抽奖
                if (pointerBtn) {
                    pointerBtn.click();
                    return 'CLICKED';
                }
                return 'NOT_FOUND';
            });

            if (drawState === 'EMPTY') {
                console.log("🎉 扫描完毕：所有任务已做完，且抽奖【剩余0次】。今日任务圆满结束！");
                break; // 真正结束跳出循环
            } else if (drawState === 'CLICKED') {
                console.log("🎰 当前无待办任务，已点击【立即开奖】！等待 6 秒动画...");
                await sleep(6000);
                continue;
            }

            // 兜底缓冲
            console.log("💤 当前页面暂时未发现可点击目标，等待 3 秒后重试...");
            await sleep(3000);
        }

        console.log("✅ 自动化流程执行完毕。");

    } catch (error) {
        console.error("❌ 运行中发生错误:", error);
    } finally {
        console.log("🧹 正在清理浏览器资源...");
        await browser.close();
    }
})();
