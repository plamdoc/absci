import os
import time
import requests
from playwright.sync_api import sync_playwright

LIST_URL = "https://hao.dxy.cn/api/client/proxy/api/stats/client/session/task/activity/list?taskType=2&pageNo=1&pageSize=15&reset=true"
MAX_CLICKS = 20  # 每次最多阅读 20 个

def send_serverchan(sckey, title, desp):
    """Server酱推送模块"""
    if not sckey:
        print("ℹ️ 未配置 SCKEY，跳过 Server酱推送。", flush=True)
        return
        
    url = f"https://sctapi.ftqq.com/{sckey}.send"
    data = {"title": title, "desp": desp}
    try:
        res = requests.post(url, data=data).json()
        if res.get("data", {}).get("error") == "SUCCESS" or res.get("code") == 0:
            print("\n✅ Server酱推送成功！请在微信查看运行结果。", flush=True)
        else:
            print(f"\n❌ Server酱推送失败: {res}", flush=True)
    except Exception as e:
        print(f"\n❌ Server酱推送异常: {e}", flush=True)

def parse_cookie_string(cookie_str):
    """转换 Cookie 格式供 Playwright 使用"""
    return [{'name': k.strip(), 'value': v.strip(), 'domain': '.dxy.cn', 'path': '/'} 
            for item in cookie_str.split(';') if '=' in item for k, v in [item.split('=', 1)]]

def run_account(cookie_str, account_idx):
    print(f"\n========== 开始执行 [账号 {account_idx}] ==========", flush=True)
    req_headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Cookie': cookie_str,
        'Accept': 'application/json'
    }
    
    summary = f"**账号 {account_idx}**:\n\n"
    
    try:
        # 获取任务列表
        res = requests.get(LIST_URL, headers=req_headers).json()
        items = res.get('results', {}).get('items', [])
        todo_tasks = [t for t in items if t.get('userStatus') != 2]
        
        print(f"✅ 发现 {len(todo_tasks)} 个未完成任务。", flush=True)
        if not todo_tasks:
            print("🎉 该账号今日任务已全部完成！", flush=True)
            return 0, summary + "🎉 今日任务已全部完成，0 次点击。\n\n"

        success_count = 0
        
        # 启动真实无头浏览器
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=['--disable-blink-features=AutomationControlled'] 
            )
            # 模拟手机端
            context = browser.new_context(
                user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
                viewport={'width': 390, 'height': 844} 
            )
            context.add_cookies(parse_cookie_string(cookie_str))
            
            page = context.new_page()
            page.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

            for i, task in enumerate(todo_tasks):
                # 检查是否达到了单次运行的最大限制
                if success_count >= MAX_CLICKS:
                    print(f"🛑 达到每次运行最大限制 {MAX_CLICKS} 个，自动安全退出。", flush=True)
                    summary += f"- 🛑 达到最大限制，下小时继续。\n"
                    break
                    
                task_id = task.get('id')
                task_title = task.get('title')
                content_url = task.get('contentUrl', '')
                print(f"[{i+1}/{len(todo_tasks)}] 📖 正在模拟阅读: {task_title}", flush=True)
                
                # 第一步：进入任务引导页并等待 DOM 稳定
                try:
                    page.goto(f"https://hao.dxy.cn/plus/activity/linkTask/{task_id}", timeout=10000, wait_until="domcontentloaded")
                    page.wait_for_timeout(1000) 

                    # 第二步：点击去阅读，并尝试捕获可能弹出的新标签页
                    with context.expect_page(timeout=5000) as new_page_info:
                        page.locator('text="去阅读"').last.click(timeout=3000)
                    
                    # 成功捕获到新标签页，切换操作句柄
                    target_page = new_page_info.value
                    target_page.wait_for_load_state("domcontentloaded", timeout=5000)

                except Exception:
                    # 兜底：如果没有弹出新标签页，继续使用原页面
                    target_page = page
                    # 只有在没有自然跳转时，才使用 content_url 强制兜底跳转
                    if content_url and "dxy.cn" in content_url and page.url not in content_url:
                        try:
                            target_page.goto(content_url, timeout=10000, wait_until="domcontentloaded")
                        except Exception:
                            pass

                # 第三步：防风控注入 - 强制修改页面可见性状态，防止后台倒计时暂停
                try:
                    target_page.evaluate("""
                        Object.defineProperty(document, 'visibilityState', {get: () => 'visible'});
                        Object.defineProperty(document, 'hidden', {get: () => false});
                    """)
                    print(f"   -> 落地页面标题: {target_page.title()}", flush=True)
                except Exception:
                    pass
                
                # 第四步：在目标页面进行物理级鼠标滚轮模拟 (共约 18 秒)
                for step in range(6):
                    try:
                        if step < 4:
                            target_page.mouse.wheel(0, 500)  # 向下滚
                        else:
                            target_page.mouse.wheel(0, -300) # 回滚一下
                    except Exception:
                        pass
                    target_page.wait_for_timeout(3000)
                
                # 第五步：如果产生了新标签页，阅读完毕后将其关闭，保持环境干净
                if target_page != page:
                    target_page.close()
                
                # 第六步：重新验证结果是否到账
                try:
                    verify_res = requests.get(LIST_URL, headers=req_headers).json()
                    new_status = next((t.get('userStatus') for t in verify_res.get('results', {}).get('items', []) if t.get('id') == task_id), 0)
                    
                    if new_status == 2:
                        print("   -> 🎉 校验成功！积分已到账。", flush=True)
                        success_count += 1
                        summary += f"- ✅ 成功阅读并认领奖励: **{task_title}**\n\n"
                    else:
                        print("   -> ❌ 校验失败：可能倒计时被暂停或触发强风控。", flush=True)
                except Exception as e:
                    print(f"   -> ⚠️ 校验状态异常: {e}", flush=True)
                        
            browser.close()
            return success_count, summary
            
    except Exception as e:
        print(f"❌ 账号 {account_idx} 运行异常: {e}", flush=True)
        return 0, summary + f"- ❌ 运行异常: {e}\n\n"

if __name__ == "__main__":
    cookie_env = os.environ.get('DXY_COOKIE', '')
    sckey = os.environ.get('SCKEY', '')
    
    cookies = [c.strip() for c in cookie_env.split('\n') if c.strip()]
    
    if not cookies:
        print("❌ 未找到 DXY_COOKIE，请检查环境变量配置。", flush=True)
    else:
        print(f"🚀 检测到 {len(cookies)} 个丁香园账号，准备开始执行...", flush=True)
        
        all_summary = ""
        total_accounts = len(cookies)
        global_success_count = 0 
        
        for idx, c in enumerate(cookies, 1):
            success_count, account_summary = run_account(c, idx)
            global_success_count += success_count
            if account_summary:
                all_summary += account_summary
                
            if idx < total_accounts:
                time.sleep(3)
                
        print("\n✅ 所有账号运行流程结束。", flush=True)
        
        if global_success_count > 0:
            push_title = f"丁香园自动阅读通知 (本轮成功:{global_success_count}个)"
            send_serverchan(sckey, push_title, all_summary)
        else:
            print("ℹ️ 本轮没有新增阅读点击，跳过 Server酱推送。", flush=True)
