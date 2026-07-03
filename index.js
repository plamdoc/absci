const puppeteer = require('puppeteer');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    console.log("🚀 [V15 智能分类破解版] 开始执行京东自动化任务...");

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
        await page.setDefaultNavigationTimeout(60000); 
        await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true }); 
        await page.setCookie(...cookies);
        await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1');

        console.log("🌐 正在进入京东互动主页...");
        await page.goto('https://interact.jd.com/', { waitUntil: 'domcontentloaded' }).catch(()=>{});
        await sleep(5000); 

        let loopCount = 0;

        while (loopCount < 60) {
            loopCount++;
            console.log(`\n🔄 === 第 ${loopCount} 轮扫描 ===`);

            try {
                // 1. 确保主页面在最前面，清理多余页面
                const pages = await browser.pages();
                if (pages.length > 1) {
                    for (let i = 1; i < pages.length; i++) {
                        if (pages[i] !== page) await pages[i].close().catch(()=>{});
                    }
                    await page.bringToFront();
                    await sleep(1000);
                }

                // 2. 结束检测
                const isFinished = await page.evaluate(() => document.body.innerText.includes('抽奖次数已用完'));
                if (isFinished) {
                    console.log("🎉 页面提示【抽奖次数已用完】，今日任务彻底圆满收工！");
                    break;
                }

                // 3. 点掉弹窗
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

                // 4. ⭐ 智能读取任务类型并点击
                const taskData = await page.evaluate(() => {
                    const btn = document.querySelector('.common-btn.btn.undone');
                    if (btn && btn.getBoundingClientRect().width > 0) {
                        // 寻找包含这个按钮的整个任务行元素 (获取任务描述)
                        const parentItem = btn.closest('.flex-center-between');
                        const infoText = parentItem ? parentItem.innerText : '';
                        
                        // 判定任务类型
                        let taskType = 'normal';
                        if (infoText.includes('浏览6S')) taskType = 'browse';
                        if (infoText.includes('关注店铺')) taskType = 'follow';

                        // 构造真实触摸事件进行点击
                        const touchStart = new TouchEvent('touchstart', { bubbles: true });
                        const touchEnd = new TouchEvent('touchend', { bubbles: true });
                        btn.dispatchEvent(touchStart);
                        setTimeout(() => { btn.dispatchEvent(touchEnd); btn.click(); }, 50);
                        
                        return { text: btn.innerText.trim(), type: taskType, fullInfo: infoText.replace(/\n/g, ' ') };
                    }
                    return null;
                });

                if (taskData) {
                    console.log(`🚀 识别到任务：【${taskData.fullInfo}】`);
                    console.log(`📌 任务分类：[${taskData.type}]，已点击进入...`);
                    
                    await sleep(4000); // 等待新页面加载
                    const currentPages = await browser.pages();
                    
                    // 🎯 针对不同任务类型执行不同的对策
                    if (taskData.type === 'follow') {
                        console.log("❤️ [关注店铺任务] 正在新页面中寻找关注按钮...");
                        let followClicked = false;
                        for (let p of currentPages) {
                            if (p === page) continue; // 不在主页找
                            try {
                                // 使用你提供的 class="e-attention" 精准定位
                                const followed = await p.evaluate(() => {
                                    const attentionBtn = document.querySelector('.e-attention, .J_globalHeaderAttention a');
                                    if (attentionBtn) {
                                        attentionBtn.click();
                                        return true;
                                    }
                                    return false;
                                });
                                if (followed) {
                                    console.log("✅ 成功在店铺页点击了【关注店铺】！");
                                    followClicked = true;
                                    await sleep(2000);
                                    break;
                                }
                            } catch(e) {}
                        }
                        if (!followClicked) console.log("⚠️ 未能找到店铺页的关注按钮，可能已经关注过或页面加载慢。");
                        
                    } else if (taskData.type === 'browse') {
                        console.log("⏳ [浏览6S任务] 正在模拟真人滑动，强等 8 秒...");
                        for (let p of currentPages) {
                            try { await p.evaluate(() => window.scrollBy(0, 800)); } catch(e) {}
                        }
                        await sleep(8000); // 必须等够时间
                    } else {
                        console.log("⚡ [普通点击任务] 无需长时等待，缓冲 3 秒...");
                        await sleep(3000);
                    }
                    
                    console.log("🔄 当前任务对策执行完毕，温柔刷新主页...");
                    await page.reload({ waitUntil: 'domcontentloaded' }).catch(()=>{});
                    await sleep(4000);
                    continue;
                }

                // 5. 展开面板
                const panel = await page.evaluate(() => {
                    const earnBtn = Array.from(document.querySelectorAll('div, span, button')).find(el => el.innerText && el.innerText.trim() === '赚更多京豆' && el.getBoundingClientRect().width > 0);
                    if (earnBtn) { 
                        earnBtn.click(); 
                        return true; 
                    }
                    return false;
                });
                if (panel) {
                    console.log("💰 展开任务面板...");
                    await sleep(2000);
                    continue;
                }

                // 6. 点击抽奖
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
                    console.log("🎰 点击抽奖！死等 6 秒开奖动画...");
                    await sleep(6000);
                    await page.reload({ waitUntil: 'domcontentloaded' }).catch(()=>{});
                    await sleep(4000);
                    continue;
                }

                console.log("💤 没看到目标任务，等待 3 秒...");
                await sleep(3000);

            } catch (err) {
                console.log(`⚠️ 捕获异常 (忽略): ${err.message.split('\n')[0]}`);
                await sleep(2000);
                await page.reload({ waitUntil: 'domcontentloaded' }).catch(()=>{});
                await sleep(4000);
            }
        }
        console.log("✅ 自动化流程完美结束。");
    } catch (error) {
        console.error("❌ 严重报错:", error);
    } finally {
        await browser.close();
    }
})();
