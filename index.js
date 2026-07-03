const puppeteer = require('puppeteer');

(async () => {
    console.log("🚀 开始初始化京东自动化任务...");

    const rawCookie = process.env.JD_COOKIE;
    if (!rawCookie) {
        console.error("❌ 严重错误：未找到 JD_COOKIE 环境变量！请在 GitHub Secrets 中配置。");
        process.exit(1);
    }

    const cookies = rawCookie.split(';').map(pair => {
        const [name, ...rest] = pair.trim().split('=');
        if (!name) return null;
        return {
            name: name.trim(),
            value: rest.join('=').trim(),
            domain: '.jd.com'
        };
    }).filter(c => c !== null);

    // 【修改点 1】：增加 protocolTimeout: 0，解除默认的 3 分钟运行超时限制
    const browser = await puppeteer.launch({
        headless: true, 
        protocolTimeout: 0, 
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    const page = await browser.newPage();
    
    // 【修改点 2】：解除页面整体导航和等待的超时限制
    page.setDefaultNavigationTimeout(0); 
    page.setDefaultTimeout(0);

    await page.setViewport({ width: 390, height: 844, isMobile: true });
    await page.setCookie(...cookies);
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1');

    console.log("🌐 正在打开京东互动页面...");
    try {
        await page.goto('https://interact.jd.com/', { waitUntil: 'networkidle2' });
    } catch (e) {
        console.error("❌ 页面加载超时或失败:", e.message);
        await browser.close();
        process.exit(1);
    }

    console.log("🤖 页面加载完毕，开始注入自动化脚本... (请耐心等待任务跑完，预计需要几分钟)");

    // 执行任务逻辑
    await page.evaluate(() => {
        return new Promise((resolve) => {
            
            function findElementByText(textList) {
                const elements = document.querySelectorAll('div, span, button');
                for (let el of elements) {
                    const text = el.textContent.trim();
                    if (el.children.length === 0 && textList.includes(text)) {
                        return el;
                    }
                }
                return null;
            }

            function findElementByImageSrc(srcPart) {
                const imgs = document.querySelectorAll('img');
                for (let img of imgs) {
                    if (img.src && img.src.includes(srcPart)) {
                        return img;
                    }
                }
                return null;
            }

            let hasClickedEarnMore = false; 

            // 执行签到
            const signBtn = findElementByImageSrc("84199557f1deec98.png");
            if (signBtn) signBtn.click();

            // 开启轮询扫描
            const autoInterval = setInterval(() => {
                
                if (document.body.innerText.includes('抽奖次数已用完，请明天再来')) {
                    clearInterval(autoInterval);
                    resolve("任务已彻底完成"); 
                    return; 
                }

                const countDiv = document.querySelector('.lottery-count');
                if (countDiv && countDiv.textContent.replace(/\s+/g, '') === '剩余0次') {
                    clearInterval(autoInterval);
                    resolve("任务已彻底完成");
                    return;
                }

                const acceptBtn = findElementByText(['开心收下', '收下', '我知道了']);
                if (acceptBtn) {
                    acceptBtn.click();
                    return; 
                }

                if (!hasClickedEarnMore) {
                    const earnMoreBtn = findElementByText(['赚更多京豆']);
                    if (earnMoreBtn) {
                        earnMoreBtn.click();
                        hasClickedEarnMore = true;
                        return; 
                    }
                }

                const taskBtn = findElementByText(['去完成', '去浏览', '领取', '去领取', '去关注', '逛一逛']);
                if (taskBtn) {
                    taskBtn.click();
                    return; 
                }

                const drawBtn = document.querySelector('.pointer');
                if (drawBtn) {
                    drawBtn.click();
                    return;
                }

            }, 4000); 
        });
    });

    console.log("✅ 检测到次数已为 0，今日任务结束，准备清理并退出...");
    await browser.close();
})();
