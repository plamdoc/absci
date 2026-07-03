const puppeteer = require('puppeteer');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    console.log("🚀 [V6 稳定版] 开始初始化京东自动化任务...");

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

    try {
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(60000); 
        await page.setViewport({ width: 390, height: 844, isMobile: true });
        await page.setCookie(...cookies);
        await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1');

        console.log("🌐 正在打开京东互动页面...");
        await page.goto('https://interact.jd.com/', { waitUntil: 'domcontentloaded' });
        await sleep(5000); 

        const currentUrl = await page.url();
        if (currentUrl.includes('login') || currentUrl.includes('plogin')) {
            console.error("❌ 致命错误：JD_COOKIE 失效被拦截到登录页！请重新抓取。");
            await browser.close();
            process.exit(1);
        }

        console.log("🤖 页面加载成功，开启智能防卡死循环...");

        let safeCounter = 0; 
        let hasClickedEarnMore = false;

        while (safeCounter < 60) {
            safeCounter++;
            console.log(`\n🔍 --- 正在进行第 ${safeCounter} 轮扫描 ---`);

            // ⭐ 修复点：强化版弹窗处理（加入真实可见性检测）
            const popupText = await page.evaluate(() => {
                // 判断元素是否在屏幕上真实可见的函数
                const isVisible = (elem) => {
                    if (!elem) return false;
                    const style = window.getComputedStyle(elem);
                    return style.display !== 'none' && 
                           style.visibility !== 'hidden' && 
                           style.opacity !== '0' && 
                           elem.offsetWidth > 0 && 
                           elem.offsetHeight > 0;
                };

                // 1. 先按类名找弹窗按钮，必须可见才点
                const acceptBtn = document.querySelector('.accept');
                if (isVisible(acceptBtn)) {
                    acceptBtn.click();
                    return '开心收下(Class)';
                }
                
                const closeIcon = document.querySelector('.close-icon');
                if (isVisible(closeIcon)) {
                    closeIcon.click();
                    return '关闭按钮(Icon)';
                }

                // 2. 按文本找弹窗按钮，必须可见才点
                const btns = Array.from(document.querySelectorAll('div, span, button'));
                const textBtn = btns.find(el => 
                    el.innerText && 
                    ['开心收下', '我知道了', '去使用', '继续抽', '开心收下吧'].includes(el.innerText.trim()) && 
                    isVisible(el)
                );
                
                if (textBtn) {
                    const txt = textBtn.innerText.trim();
                    textBtn.click();
                    return txt;
                }
                return null;
            });

            if (popupText) {
                console.log(`🎁 成功清理真实可见弹窗：【${popupText}】，等待 2 秒...`);
                await sleep(2000);
                continue; 
            }

            // ⭐ 展开面板
            if (!hasClickedEarnMore) {
                const earnMoreHandled = await page.evaluate(() => {
                    const btns = Array.from(document.querySelectorAll('div, span, button'));
                    const btn = btns.find(el => el.innerText && el.innerText.trim() === '赚更多京豆');
                    if (btn && btn.offsetWidth > 0) { // 同样加入可见判断
                        btn.click();
                        return true;
                    }
                    return false;
                });
                if (earnMoreHandled) {
                    console.log("💰 已点击【赚更多京豆】，展开任务列表...");
                    hasClickedEarnMore = true;
                    await sleep(2500);
                    continue;
                }
            }

            // ⭐ 执行任务
            const taskText = await page.evaluate(() => {
                const taskBtn = document.querySelector('.common-btn.btn.undone');
                // 确保任务按钮也是可见的
                if (taskBtn && taskBtn.offsetWidth > 0) {
                    const text = taskBtn.innerText.trim();
                    taskBtn.click();
                    return text;
                }
                return null;
            });

            if (taskText) {
                console.log(`🚀 发现任务【${taskText}】，强制等待 8 秒执行...`);
                await sleep(8000); 

                const pages = await browser.pages();
                if (pages.length > 1) {
                    console.log(`🧹 正在关闭 ${pages.length - 1} 个多余任务页面...`);
                    for (let i = 1; i < pages.length; i++) {
                        await pages[i].close();
                    }
                    await pages[0].bringToFront(); 
                    await sleep(1500);
                }
                continue; 
            }

            // ⭐ 抽奖判定
            const drawState = await page.evaluate(() => {
                const countDiv = document.querySelector('.lottery-count');
                const pointerBtn = document.querySelector('.pointer');
                
                if (countDiv && countDiv.innerText.replace(/\s+/g, '') === '剩余0次') {
                    return 'EMPTY'; 
                }
                if (pointerBtn && pointerBtn.offsetWidth > 0) { // 抽奖按钮也要可见
                    pointerBtn.click();
                    return 'CLICKED';
                }
                return 'NOT_FOUND';
            });

            if (drawState === 'EMPTY') {
                console.log("🎉 扫描完毕：抽奖【剩余0次】。今日任务圆满结束！");
                break; 
            } else if (drawState === 'CLICKED') {
                console.log("🎰 已点击【立即开奖】！等待 6 秒...");
                await sleep(6000);
                continue;
            }

            console.log("💤 暂无匹配目标，等待 3 秒后进入下一轮...");
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
