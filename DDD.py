import os
import time
import requests
from playwright.sync_api import sync_playwright

LIST_URL = "https://hao.dxy.cn/api/client/proxy/api/stats/client/session/task/activity/list?taskType=2&pageNo=1&pageSize=15&reset=true"
# 限制单次运行最大点击数为 5
MAX_CLICKS = 5

def send_serverchan(sckey, title, desp):
    """Server酱推送模块 (保留备用)"""
    if not sckey:
        return
        
    url = f"https://sctapi.ftqq.com/{sckey}.send"
    data = {"title": title, "desp": desp}
    try:
        requests.post(url, data=data, timeout=10)
    except Exception:
        pass

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
        res = requests.get(LIST_URL, headers=req_headers).json()
        items = res.get('results', {}).get('items', [])
        todo_tasks = [t for t in items if t.get('userStatus') != 2]
        
        print(f"✅ 发现 {len(todo_tasks)} 个未完成任务。", flush=True)
        if not todo_tasks:
            print("🎉 该账号今日任务已全部完成！", flush=True)
            return 0, summary + "🎉 今日任务已全部完成，0 次点击。\n\n"

        success_count = 0
        
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=['--disable-blink-features=AutomationControlled'] 
            )
            context = browser.new_context(
                user_agent=req_headers['User-Agent'],
                viewport={'width': 1280, 'height': 800}
            )
            context.add_cookies(parse_cookie_string(cookie_str))
            
            page = context.new_page()
            page.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

            for i, task in enumerate(todo_tasks):
                if success_count >= MAX_CLICKS:
                    print(f"🛑 达到每次运行最大限制 {MAX_CLICKS} 个，自动安全退出。剩下的留到下小时。", flush=True)
                    summary += f"- 🛑 达到最大限制，下小时继续。\n"
                    break
                    
                task_id = task.get('id')
                task_title = task.get('title')
                print(f"[{i+1}/{len(todo_tasks)}] 📖 正在模拟阅读: {task_title}", flush=True)
                
                try:
                    page.goto(f"https://hao.dxy.cn/plus/activity/linkTask/{task_id}", timeout=15000)
                except Exception:
                    pass 
                
                page.wait_for_timeout(4000)
                
                for _ in range(4):
                    try:
                        page.evaluate("window.scrollBy(0, 500)")
                    except Exception:
                        pass
                    page.wait_for_timeout(3000)
                
                try:
                    verify_res = requests.get(LIST_URL, headers=req_headers).json()
                    new_status = next((t.get('userStatus') for t in verify_res.get('results', {}).get('items', []) if t.get('id') == task_id), 0)
                    
                    if new_status == 2:
                        print("   -> 🎉 校验成功！积分已到账。", flush=True)
                        success_count += 1
                    else:
                        print("   -> ❌ 校验失败：时长不足或触发平台风控。", flush=True)
                except Exception as e:
                    print(f"   -> ⚠️ 校验状态异常: {e}", flush=True)
                        
            browser.close()
            summary += f"- ✅ 本轮成功点击: **{success_count}** 个。\n\n"
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
        
        # 将运行结果状态写入 GITHUB_ENV 供下一步 Action 判断
        env_file = os.getenv('GITHUB_ENV')
        
        if global_success_count > 0:
            print("📣 本轮有成功记录，触发推送通知。", flush=True)
            if env_file:
                with open(env_file, "a") as f:
                    f.write("HAS_NEW_SUCCESS=true\n")
            
            # 兼容 Server酱推送（如果配置了SCKEY的话）
            push_title = f"丁香园自动阅读通知 (本轮成功:{global_success_count}个)"
            send_serverchan(sckey, push_title, all_summary)
        else:
            print("ℹ️ 本轮无新增成功记录，已静默跳过推送。", flush=True)
            if env_file:
                with open(env_file, "a") as f:
                    f.write("HAS_NEW_SUCCESS=false\n")
