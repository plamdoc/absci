const puppeteer = require('puppeteer');

(async () => {
    console.log("🚀 开始初始化京东自动化任务...");

    // 1. 获取环境变量中的 Cookie
    const rawCookie = process.env.JD_COOKIE;
    if (!rawCookie) {
        console.error("❌ 严重错误：未找到 JD_COOKIE 环境变量！请在 GitHub Secrets 中配置。");
        process.exit(1);
    }

    // 2. 将字符串 Cookie 转换为 Puppeteer 需要的格式
    const cookies = rawCookie.split(';').map(pair => {
        const [name, ...rest] = pair.trim().split('=');
        if (!name) return null;
        return {
            name: name.trim(),
            value: rest.join('=').trim(),
            domain: '.jd.com'
        };
    }).filter(c => c !== null);

    // 3. 启动无头浏览器 (针对 GitHub Actions 的 Linux 环境做了参数优化)
    const browser = await puppeteer.launch({
        headless: true, // 必须开启无头模式
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled' // 简单防机器识别
        ]
    });

    const page = await browser.newPage();
    
    // 设置移动端视图，模拟手机请求
    await page.setViewport({ width: 390, height: 844, isMobile: true });
    
    // 注入 Cookie
    await page.setCookie(...cookies);
    
    // 伪装 User-Agent
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1');

    console.log("🌐 正在打开京东互动页面...");
    try {
        await page.goto('https://interact.jd.com/', { waitUntil: 'networkidle2', timeout: 30000 });
    } catch (e) {
        console.error("❌ 页面加载超时或失败:", e.message);
        await browser.close();
        process.exit(1);
    }

    console.log("🤖 页面加载完毕，开始注入自动化脚本...");

    // 4. 在浏览器上下文中执行任务逻辑
    // page.evaluate 内的代码运行在虚拟浏览器里，可以直接访问 DOM
    await page.evaluate(() => {
        return new Promise((resolve) => {
            
            // 辅助函数
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
                
                // ⭐ 终止条件检测
                if (document.body.innerText.includes('抽奖次数已用完，请明天再来')) {
                    clearInterval(autoInterval);
                    resolve("任务已彻底完成"); // 触发 Promise 结束，让 Node.js 知道可以关机了
                    return; 
                }

                const countDiv = document.querySelector('.lottery-count');
                if (countDiv && countDiv.textContent.replace(/\s+/g, '') === '剩余0次') {
                    clearInterval(autoInterval);
                    resolve("任务已彻底完成");
                    return;
                }

                // 处理弹窗
                const acceptBtn = findElementByText(['开心收下', '收下', '我知道了']);
                if (acceptBtn) {
                    acceptBtn.click();
                    return; 
                }

                // 展开任务
                if (!hasClickedEarnMore) {
                    const earnMoreBtn = findElementByText(['赚更多京豆']);
                    if (earnMoreBtn) {
                        earnMoreBtn.click();
                        hasClickedEarnMore = true;
                        return; 
                    }
                }

                // 做任务
                const taskBtn = findElementByText(['去完成', '去浏览', '领取', '去领取', '去关注', '逛一逛']);
                if (taskBtn) {
                    taskBtn.click();
                    return; 
                }

                // 抽奖
                const drawBtn = document.querySelector('.pointer');
                if (drawBtn) {
                    drawBtn.click();
                    return;
                }

            }, 4000); // 4秒扫描一次
        });
    });

    console.log("✅ 检测到次数已为 0，今日任务结束，准备清理并退出...");
    await browser.close();
})();
