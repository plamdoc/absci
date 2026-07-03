import os
import time
import requests
from playwright.sync_api import sync_playwright

LIST_URL = "https://hao.dxy.cn/api/client/proxy/api/stats/client/session/task/activity/list?taskType=2&pageNo=1&pageSize=15&reset=true"
MAX_CLICKS = 5  # ✨ 恢复最大点击次数限制

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
                # ✨ 新增：检查是否达到了单次运行的最大限制
                if success_count >= MAX_CLICKS:
                    print(f"🛑 达到每次运行最大限制 {MAX_CLICKS} 个，自动安全退出。剩下的留到下小时。", flush=True)
                    summary += f"- 🛑 达到最大限制，下小时继续。\n"
                    break
                    
                task_id = task.get('id')
                task_title = task.get('title')
                content_url = task.get('contentUrl', '')
                print(f"[{i+1}/{len(todo_tasks)}] 📖 正在模拟阅读: {task_title}", flush=True)
                
                # 第一步：先触发 linkTask 记录点击行为，可能会跳转到二次确认页
                try:
                    page.goto(f"https://hao.dxy.cn/plus/activity/linkTask/{task_id}", timeout=10000)
                    page.wait_for_timeout(2000)
                    
                    # 检测并处理二次确认弹窗
                    confirm_btn = page.locator('text="去阅读"')
                    if confirm_btn.count() > 0:
                        print("   -> 发现二次确认页面，执行点击...", flush=True)
                        confirm_btn.last.click(timeout=3000)
                        page.wait_for_timeout(2000)
                except Exception:
                    pass 
                
                # 第二步：如果有明确的文章地址，强制转入，确保到达最终文章页
                if content_url and "dxy.cn" in content_url:
                    try:
                        page.goto(content_url, timeout=15000)
                    except Exception:
                        pass
                
                # 第三步：等待页面加载完毕，确保 15秒倒计时的 JS 已经加载
                try:
                    page.wait_for_load_state("networkidle", timeout=6000)
                except Exception:
                    pass
                
                try:
                    print(f"   -> 落地页面标题: {page.title()}", flush=True)
                except Exception:
                    pass
                
                # 第四步：物理级鼠标滚轮模拟 + 长时间挂机 (共 28 秒)
                for step in range(8):
                    try:
                        if step < 6:
                            page.mouse.wheel(0, 500)  # 向下滚
                        else:
                            page.mouse.wheel(0, -300) # 回滚一下，模拟看完
                    except Exception:
                        pass
                    page.wait_for_timeout(3500)
                
                # 重新验证结果
                try:
                    verify_res = requests.get(LIST_URL, headers=req_headers).json()
                    new_status = next((t.get('userStatus') for t in verify_res.get('results', {}).get('items', []) if t.get('id') == task_id), 0)
                    
                    if new_status == 2:
                        print("   -> 🎉 校验成功！15秒阅读完成，积分已到账。", flush=True)
                        success_count += 1
                        summary += f"- ✅ 成功阅读并认领奖励: **{task_title}**\n\n"
                        # ✨ 移除了一旦成功就强制 break 的错误逻辑，允许循环继续
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
        print("❌ 未找到 DXY_COOKIE，请检查 Secrets 配置。", flush=True)
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
