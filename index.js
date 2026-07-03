const puppeteer = require('puppeteer');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    console.log("🚀 [V13 物理坐标点击版] 开始执行京东自动化任务...");

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

    async function createFreshPage() {
        const pages = await browser.pages();
        for (let p of pages) {
            await p.close().catch(() => {});
        }
        const newPage = await browser.newPage();
        await newPage.setDefaultNavigationTimeout(60000); 
        // 开启移动端及触摸模拟
        await newPage.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true }); 
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
        let taskCount = 0; // 最多 6 次的任务计数器

        while (loopCount < 60) {
            loopCount++;
            console.log(`\n🔄 === 第 ${loopCount} 轮扫描 ===`);

            try {
                // 1. 结束检测
                const isFinished = await page.evaluate(() => document.body.innerText.includes('抽奖次数已用完'));
                if (isFinished) {
                    console.log("🎉 页面提示【抽奖次数已用完】，今日任务圆满收工！");
                    break;
                }

                // 2. 点掉弹窗
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

                // 3. ⭐ 物理坐标点击未完成的任务 (精准匹配你提供的 .common-btn.btn.undone)
                if (taskCount < 6) {
                    const taskBtnHandle = await page.$('.common-btn.btn.undone');
                    
                    if (taskBtnHandle) {
                        const isVisible = await page.evaluate(el => el.getBoundingClientRect().width > 0, taskBtnHandle);
                        
                        if (isVisible) {
                            // 确保元素滑动到了可视区域
                            await page.evaluate(el => el.scrollIntoView({block: 'center'}), taskBtnHandle);
                            await sleep(1000); // 等待滚动平滑结束
                            
                            // 提取按钮上的文字
                            const txt = await page.evaluate(el => el.innerText.trim(), taskBtnHandle);
                            
                            // ⭐ 核心杀招：获取元素的真实屏幕坐标，算出中心点
                            const box = await taskBtnHandle.boundingBox();
                            if (box) {
                                const x = box.x + box.width / 2;
                                const y = box.y + box.height / 2;
                                
                                // 用原生触摸/鼠标事件硬戳这个屏幕坐标
                                await page.mouse.click(x, y);
                                
                                taskCount++; 
                                console.log(`🚀 [${taskCount}/6] 成功坐标物理点击：【${txt}】！死等 8 秒...`);
                                
                                // 雷打不动等 8 秒，满足浏览时长
                                await sleep(8000);
                                
                                console.log("🔥 浏览时间已满！正在销毁并重新打开页面...");
                                page = await createFreshPage();
                                await page.goto('https://interact.jd.com/', { waitUntil: 'domcontentloaded' }).catch(()=>{});
                                await sleep(5000);
                                continue;
                            }
                        }
                    }
                } else {
                    console.log(`⚠️ 已完成设定的 6 次任务，强制跳过任务环节。`);
                }

                // 4. 展开面板 (如果页面上连展开面板的按钮都没有，它会自动跳过这一步)
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

                // 5. 点击抽奖 (也加上物理坐标点击防止失效)
                const drawBtnHandle = await page.$('.pointer');
                if (drawBtnHandle) {
                    const count = await page.evaluate(() => {
                        const c = document.querySelector('.lottery-count');
                        return c ? c.innerText : '';
                    });
                    
                    if (count.includes('0次')) {
                        console.log("🎉 剩余抽奖0次，今日结束！");
                        break;
                    }
                    
                    const isVisible = await page.evaluate(el => el.getBoundingClientRect().width > 0, drawBtnHandle);
                    if (isVisible) {
                        const box = await drawBtnHandle.boundingBox();
                        if (box) {
                            const x = box.x + box.width / 2;
                            const y = box.y + box.height / 2;
                            await page.mouse.click(x, y); // 物理戳抽奖按钮
                            
                            console.log("🎰 点击抽奖！死等 6 秒开奖动画...");
                            await sleep(6000);
                            
                            page = await createFreshPage();
                            await page.goto('https://interact.jd.com/', { waitUntil: 'domcontentloaded' }).catch(()=>{});
                            await sleep(5000);
                            continue;
                        }
                    }
                }

                console.log("💤 没看到目标，等待 3 秒...");
                await sleep(3000);

            } catch (err) {
                console.log(`⚠️ 捕获到底层异常跳出: ${err.message.split('\n')[0]}`);
                console.log("🔧 触发防御机制：直接销毁当前整个页面并重生！");
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
