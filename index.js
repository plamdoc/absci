const puppeteer = require('puppeteer');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    console.log("🚀 [V7 破壁版] 开始初始化京东自动化任务...");

    const rawCookie = process.env.JD_COOKIE;
    if (!rawCookie) {
        console.error("❌ 未找到 JD_COOKIE，退出！");
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

    try {
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(60000); 
        await page.setViewport({ width: 390, height: 844, isMobile: true });
        await page.setCookie(...cookies);
        await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1');

        console.log("🌐 正在打开京东互动页面...");
        await page.goto('https://interact.jd.com/', { waitUntil: 'domcontentloaded' });
        await sleep(4000); 

        // 检测拦截
        const currentUrl = await page.url();
        if (currentUrl.includes('login') || currentUrl.includes('plogin')) {
            console.error("❌ Cookie 已失效被拦截到登录页！");
            await browser.close();
            process.exit(1);
        }

        console.log("🤖 页面初步加载成功，正在执行页面滑动以触发懒加载...");
        
        // 关键动作：模拟真人往下滑动，再滑回顶部，唤醒所有隐藏的 API 请求
        await page.evaluate(() => window.scrollBy(0, 800));
        await sleep(1500);
        await page.evaluate(() => window.scrollBy(0, 800));
        await sleep(1500);
        await page.evaluate(() => window.scrollTo(0, 0));
        await sleep(2000);

        console.log("👀 准备就绪，开始扫描目标...");

        let safeCounter = 0; 
        let emptyRoundCount = 0; // 记录连续什么都没找到的次数

        while (safeCounter < 60) {
            safeCounter++;
            console.log(`\n🔍 --- 第 ${safeCounter} 轮扫描 ---`);

            // ⭐ 1. 查杀弹窗 (使用更兼容的 getBoundingClientRect 判断可见性)
            const popupText = await page.evaluate(() => {
                const isVisible = (elem) => elem && elem.getBoundingClientRect().width > 0;

                const acceptBtn = document.querySelector('.accept');
                if (isVisible(acceptBtn)) { acceptBtn.click(); return '开心收下(类名)'; }
                
                const closeIcon = document.querySelector('.close-icon');
                if (isVisible(closeIcon)) { closeIcon.click(); return '关闭(图标)'; }

                const btns = Array.from(document.querySelectorAll('div, span, button'));
                const textBtn = btns.find(el => 
                    el.innerText && ['开心收下', '我知道了', '去使用', '继续抽'].includes(el.innerText.trim()) && isVisible(el)
                );
                
                if (textBtn) {
                    const txt = textBtn.innerText.trim();
                    textBtn.click();
                    return txt;
                }
                return null;
            });

            if (popupText) {
                console.log(`🎁 成功清理弹窗：【${popupText}】，等待 2 秒...`);
                emptyRoundCount = 0;
                await sleep(2000);
                continue; 
            }

            // ⭐ 2. 查找并执行任务 (双管齐下：类名匹配 + 文本匹配)
            const taskInfo = await page.evaluate(() => {
                const isVisible = (elem) => elem && elem.getBoundingClientRect().width > 0;
                
                // 方式 A：用你找的精确类名
                const preciseTask = document.querySelector('.common-btn.btn.undone');
                if (isVisible(preciseTask)) {
                    const txt = preciseTask.innerText.trim();
                    preciseTask.click();
                    return txt;
                }

                // 方式 B：兜底文本查找
                const btns = Array.from(document.querySelectorAll('div, span, button'));
                const textTask = btns.find(el => {
                    const txt = el.innerText ? el.innerText.trim() : '';
                    return ['去完成', '去浏览', '去关注', '逛一逛'].includes(txt) && isVisible(el);
                });
                
                if (textTask) {
                    const txt = textTask.innerText.trim();
                    textTask.click();
                    return txt;
                }
                
                return null;
            });

            if (taskInfo) {
                console.log(`🚀 发现并点击任务：【${taskInfo}】！强制死等 8 秒...`);
                emptyRoundCount = 0;
                await sleep(8000); 

                const pages = await browser.pages();
                if (pages.length > 1) {
                    console.log(`🧹 正在关闭 ${pages.length - 1} 个广告页面...`);
                    for (let i = 1; i < pages.length; i++) await pages[i].close();
                    await pages[0].bringToFront(); 
                    await sleep(1500);
                }
                continue; 
            }

            // ⭐ 3. 抽奖判定
            const drawState = await page.evaluate(() => {
                const countDiv = document.querySelector('.lottery-count');
                const pointerBtn = document.querySelector('.pointer');
                
                if (countDiv && countDiv.innerText.replace(/\s+/g, '') === '剩余0次') return 'EMPTY'; 
                if (pointerBtn && pointerBtn.getBoundingClientRect().width > 0) {
                    pointerBtn.click();
                    return 'CLICKED';
                }
                return 'NOT_FOUND';
            });

            if (drawState === 'EMPTY') {
                console.log("🎉 扫描完毕：抽奖【剩余0次】。今日任务彻底圆满结束！");
                break; 
            } else if (drawState === 'CLICKED') {
                console.log("🎰 已点击【立即开奖】！等待 6 秒动画...");
                emptyRoundCount = 0;
                await sleep(6000);
                continue;
            }

            // ⭐ 4. 兜底与防卡死诊断
            emptyRoundCount++;
            console.log(`💤 暂无匹配目标 (连续 ${emptyRoundCount} 次未找到)，等待 3 秒...`);
            await sleep(3000);

            // 如果连续 5 次什么都没找到，说明可能卡在某个奇怪的遮罩层了，随便点一下空白处并往下滑一点
            if (emptyRoundCount >= 5) {
                console.log("⚠️ 尝试强行唤醒页面 (点击空白处并滚动)...");
                await page.mouse.click(10, 10);
                await page.evaluate(() => window.scrollBy(0, 300));
                emptyRoundCount = 0; // 重置计数器
            }
        }

        console.log("✅ 自动化流程运行完毕。");

    } catch (error) {
        console.error("❌ 运行中发生报错:", error);
    } finally {
        console.log("🧹 清理并退出浏览器...");
        await browser.close();
    }
})();
