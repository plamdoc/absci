#!/usr/bin/env python
# cron:40 7,21 * * *
# new Env("科研通签到")
# coding=utf-8

"""
AbleSci自动签到脚本 
创建日期：2025年8月8日
更新日期：2025年9月2日 >> 修复日志输出时间为北京时间 ; 修复签到前后用户信息显示 ; 优化登录失败处理 ; 优化签到已签到处理
更新日期：2025年9月3日 >> 保护隐私，不在日志中显示完整邮箱和用户名
更新日期：2026年3月22日 >> 支持本地.env文件; 使用zoneinfo/pytz处理时区; 统一通知器; 修复zoneinfo时区查找失败问题,增加回退机制; 修复已签到处理逻辑;\n更新日期：2026年9月18日 >> 兼容新版登录页CSRF获取；增加登录调试信息；更新GitHub Actions输出写法；避免日志打印账号密码原文；
作者：daitcl
"""

import os
import sys
import time
import requests
from bs4 import BeautifulSoup
import json
import datetime
from pathlib import Path
from datetime import timezone, timedelta


try:
    from zoneinfo import ZoneInfo
    ZONEINFO_AVAILABLE = True
except ImportError:
    ZONEINFO_AVAILABLE = False

# 环境变量名常量
ENV_ACCOUNTS = "ABLESCI_ACCOUNTS"

def load_env_file():
    """
    加载脚本所在目录的 .env 文件，支持两种格式：
    1. 标准键值对：KEY=VALUE
    2. 无键账号行：直接写 邮箱:密码（自动归入 ABLESCI_ACCOUNTS）
    
    优先级：系统环境变量 > .env 中的标准键值对 > .env 中的无键账号行
    重复键会合并（用换行符连接）
    """
    script_dir = Path(__file__).parent
    env_file = script_dir / ".env"
    if not env_file.exists():
        return

    env_vars = {}
    account_lines = []

    with open(env_file, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '=' in line:
                key, value = line.split('=', 1)
                key = key.strip()
                value = value.strip()
                if key in env_vars:
                    env_vars[key] = env_vars[key] + "\n" + value
                else:
                    env_vars[key] = value
            else:
                account_lines.append(line)

    for key, value in env_vars.items():
        if key not in os.environ:
            os.environ[key] = value
            print(f"已从 {env_file} 设置环境变量: {key}")
        else:
            print(f"环境变量 {key} 已存在（来自系统），跳过 .env 中的值")

    if ENV_ACCOUNTS not in os.environ and ENV_ACCOUNTS not in env_vars:
        if account_lines:
            accounts_value = "\n".join(account_lines)
            os.environ[ENV_ACCOUNTS] = accounts_value
            print(f"已从 {env_file} 的无键行设置 {ENV_ACCOUNTS}（共 {len(account_lines)} 个账号）")
    elif account_lines:
        print(f"警告：存在无键账号行，但 {ENV_ACCOUNTS} 已通过系统或标准键值对设置，忽略无键行")

    if ENV_ACCOUNTS in os.environ:
        val = os.environ[ENV_ACCOUNTS]
        print(f"当前 {ENV_ACCOUNTS} 内容预览: {val[:100]}{'...' if len(val) > 100 else ''}")

load_env_file()

def get_beijing_time():
    """
    返回北京时间（带时区信息）
    优先使用 zoneinfo，如果失败则尝试 pytz，最后使用手动 UTC+8 偏移。
    """
    if ZONEINFO_AVAILABLE:
        try:
            return datetime.datetime.now(ZoneInfo("Asia/Shanghai"))
        except Exception:
            pass
        
    try:
        import pytz
        return datetime.datetime.now(pytz.timezone("Asia/Shanghai"))
    except ImportError:
        pass

    return datetime.datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=8)))

def protect_privacy(text):
    """保护隐私信息，隐藏部分邮箱和用户名"""
    if not text:
        return text
        
    # 邮箱隐私处理
    if "@" in text:
        parts = text.split("@")
        if len(parts[0]) > 2:
            protected_local = parts[0][:2] + "***"
        else:
            protected_local = "***"
        return f"{protected_local}@{parts[1]}"
    
    # 用户名隐私处理
    if len(text) > 2:
        return text[:2] + "***"
    else:
        return "***"

class Notifier:
    def __init__(self, title="科研通签到"):
        self.log_content = []
        self.title = title
        self.notify_enabled = False
        
        try:
            sys.path.append(os.path.dirname(os.path.abspath(__file__)))
            from sendNotify import send
            self.send = send
            self.notify_enabled = True
        except ImportError:
            try:
                parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                sys.path.append(parent_dir)
                from sendNotify import send
                self.send = send
                self.notify_enabled = True
            except Exception as e:
                self.log(f"导入通知模块失败: {str(e)}", "warning")
                self.notify_enabled = False
    
    def log(self, message, level="info"):
        """格式化日志输出并保存到内容 - 使用北京时间"""
        beijing_time = get_beijing_time()
        timestamp = beijing_time.strftime("%Y-%m-%d %H:%M:%S")
        
        level_map = {
            "info": "ℹ️",
            "success": "✅",
            "error": "❌",
            "warning": "⚠️"
        }
        symbol = level_map.get(level, "ℹ️")
        log_message = f"[{timestamp}] {symbol} {message}"
        print(log_message)
        self.log_content.append(log_message)
        
    def send_notification(self):
        """发送通知"""
        if not self.notify_enabled:
            self.log("通知功能未启用", "warning")
            return False
            
        content = "\n".join(self.log_content)
        
        try:
            self.send(self.title, content)
            self.log("通知发送成功", "success")
            return True
        except Exception as e:
            self.log(f"发送通知失败: {str(e)}", "error")
            return False
    
    def get_content(self):
        """获取日志内容"""
        return "\n".join(self.log_content)

class AbleSciAuto:
    def __init__(self, email, password, notifier=None):
        self.session = requests.Session()
        self.email = email
        self.password = password
        self.username = None
        self.points = None
        self.sign_days = None
        self.notifier = notifier if notifier else Notifier()
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
            "sec-ch-ua": "\"Not)A;Brand\";v=\"8\", \"Chromium\";v=\"138\", \"Google Chrome\";v=\"138\"",
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": "\"Windows\"",
            "X-Requested-With": "XMLHttpRequest"
        }
        self.start_time = time.time()
        protected_email = protect_privacy(self.email)
        self.log(f"处理账号: {protected_email}", "info")
        
    def log(self, message, level="info"):
        """代理日志到通知系统"""
        self.notifier.log(message, level)
        
    def get_csrf_token(self):
        """获取CSRF令牌，兼容新版/旧版科研通登录页"""
        login_url = "https://www.ablesci.com/site/login"

        # 首次访问登录页时不要强制声明 AJAX 请求，尽量模拟正常浏览器打开页面
        page_headers = {
            "User-Agent": self.headers.get("User-Agent", ""),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Referer": "https://www.ablesci.com/",
            "Connection": "keep-alive",
        }

        try:
            response = self.session.get(
                login_url,
                headers=page_headers,
                timeout=30,
                allow_redirects=True
            )

            self.log(
                f"登录页状态码: {response.status_code}，最终URL: {response.url}",
                "info"
            )

            if response.status_code != 200:
                self.log(
                    f"获取CSRF令牌失败，状态码: {response.status_code}",
                    "error"
                )
                return ""

            soup = BeautifulSoup(response.text, "html.parser")
            csrf_token = ""

            # 1. 新版常见形式：
            # <meta name="csrf-token" content="...">
            meta_csrf = soup.find("meta", attrs={"name": "csrf-token"})
            if meta_csrf:
                csrf_token = (meta_csrf.get("content") or "").strip()

            # 2. 兼容部分框架使用 csrfToken / _csrf-token
            if not csrf_token:
                for meta_name in ("csrfToken", "_csrf-token", "csrf"):
                    meta_tag = soup.find("meta", attrs={"name": meta_name})
                    if meta_tag:
                        csrf_token = (meta_tag.get("content") or "").strip()
                        if csrf_token:
                            break

            # 3. 兼容旧版：
            # <input type="hidden" name="_csrf" value="...">
            if not csrf_token:
                input_csrf = soup.find("input", attrs={"name": "_csrf"})
                if input_csrf:
                    csrf_token = (input_csrf.get("value") or "").strip()

            # 4. 再兼容其他常见隐藏字段命名
            if not csrf_token:
                for input_name in ("csrf_token", "csrf-token", "csrf"):
                    input_tag = soup.find("input", attrs={"name": input_name})
                    if input_tag:
                        csrf_token = (input_tag.get("value") or "").strip()
                        if csrf_token:
                            break

            if csrf_token:
                self.log(
                    f"成功获取CSRF令牌，长度: {len(csrf_token)}",
                    "success"
                )
                return csrf_token

            # 找不到时输出不含密码的诊断信息，方便从 GitHub Actions 日志判断
            page_title = "未知"
            if soup.title and soup.title.string:
                page_title = soup.title.string.strip()

            self.log(
                f"未在登录页中找到CSRF令牌；页面标题: {page_title}",
                "error"
            )
            self.log(
                f"登录页响应长度: {len(response.text)} 字符",
                "warning"
            )

            # 只显示前 300 个字符，且压成一行；不输出账号密码
            preview = " ".join(response.text[:300].split())
            if preview:
                self.log(f"页面内容预览: {preview}", "warning")

            # 输出收到的 Cookie 名称，便于判断网站是否改为 Cookie CSRF
            cookie_names = [cookie.name for cookie in self.session.cookies]
            if cookie_names:
                self.log(
                    "当前会话Cookie名称: " + ", ".join(cookie_names),
                    "info"
                )

            return ""

        except requests.RequestException as e:
            self.log(
                f"获取CSRF令牌网络请求失败: {type(e).__name__}: {str(e)}",
                "error"
            )
        except Exception as e:
            self.log(
                f"获取CSRF令牌时出错: {type(e).__name__}: {str(e)}",
                "error"
            )

        return ""

    def login(self):
        """执行登录操作"""
        if not self.email or not self.password:
            self.log("邮箱或密码为空", "error")
            return False

        login_url = "https://www.ablesci.com/site/login"
        csrf_token = self.get_csrf_token()

        if not csrf_token:
            self.log("无法获取CSRF令牌", "error")
            return False

        # 保留原脚本字段，兼容旧版登录接口
        login_data = {
            "_csrf": csrf_token,
            "email": self.email,
            "password": self.password,
            "remember": "off"
        }

        # POST 登录时增加 CSRF 请求头，兼容新版 AJAX 登录
        headers = self.headers.copy()
        headers.update({
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Referer": "https://www.ablesci.com/site/login",
            "Origin": "https://www.ablesci.com",
            "X-CSRF-Token": csrf_token,
            "X-Requested-With": "XMLHttpRequest",
        })

        try:
            response = self.session.post(
                login_url,
                data=login_data,
                headers=headers,
                timeout=30,
                allow_redirects=True
            )

            self.log(
                f"登录请求状态码: {response.status_code}，最终URL: {response.url}",
                "info"
            )

            if response.status_code != 200:
                self.log(
                    f"登录请求失败，状态码: {response.status_code}",
                    "error"
                )
                return False

            # 优先按 JSON 解析
            try:
                result = response.json()

                if result.get("code") == 0:
                    self.log(
                        f"登录成功: {result.get('msg', '账户验证通过')}",
                        "success"
                    )
                    return True

                self.log(
                    f"登录失败: {result.get('msg', result)}",
                    "error"
                )
                return False

            except (json.JSONDecodeError, ValueError):
                # 如果服务器返回 HTML，则结合页面内容和登录态再次判断
                body = response.text or ""

                # 旧版常见成功判断
                if "退出" in body or "登录成功" in body:
                    self.log("登录成功", "success")
                    return True

                # 再访问首页，用页面内容确认 Session 是否已经处于登录状态
                verify_headers = {
                    "User-Agent": self.headers.get("User-Agent", ""),
                    "Referer": "https://www.ablesci.com/site/login",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                }

                verify = self.session.get(
                    "https://www.ablesci.com/",
                    headers=verify_headers,
                    timeout=30,
                    allow_redirects=True
                )

                if verify.status_code == 200:
                    verify_soup = BeautifulSoup(verify.text, "html.parser")

                    # 原脚本首页登录后的用户名元素
                    username_element = verify_soup.select_one(
                        ".mobile-hide.able-head-user-vip-username"
                    )

                    # 页面出现“退出”通常也意味着已登录
                    if username_element or "退出" in verify.text:
                        self.log("登录成功（已通过首页登录状态确认）", "success")
                        return True

                content_type = response.headers.get("Content-Type", "")
                self.log(
                    f"登录失败: 返回内容无法识别；Content-Type: {content_type}",
                    "error"
                )

                preview = " ".join(body[:300].split())
                if preview:
                    self.log(
                        f"登录响应内容预览: {preview}",
                        "warning"
                    )

        except requests.RequestException as e:
            self.log(
                f"登录网络请求失败: {type(e).__name__}: {str(e)}",
                "error"
            )
        except Exception as e:
            self.log(
                f"登录过程中出错: {type(e).__name__}: {str(e)}",
                "error"
            )

        return False

    def get_user_info(self):
        """获取用户信息（包括用户名、积分和签到天数）"""
        home_url = "https://www.ablesci.com/"
        headers = self.headers.copy()
        headers["Referer"] = "https://www.ablesci.com/"
        
        try:
            response = self.session.get(home_url, headers=headers, timeout=30)
            if response.status_code == 200:
                soup = BeautifulSoup(response.text, 'html.parser')
                
                # 用户名
                username_element = soup.select_one('.mobile-hide.able-head-user-vip-username')
                if username_element:
                    self.username = username_element.text.strip()
                    protected_username = protect_privacy(self.username)
                    self.log(f"用户名: {protected_username}", "info")
                else:
                    self.log("无法定位用户名元素", "warning")
                
                # 积分
                points_element = soup.select_one('#user-point-now')
                if points_element:
                    self.points = points_element.text.strip()
                    self.log(f"当前积分: {self.points}", "info")
                else:
                    self.log("无法获取积分信息", "warning")
                
                # 连续签到天数
                sign_days_element = soup.select_one('#sign-count')
                if sign_days_element:
                    self.sign_days = sign_days_element.text.strip()
                    self.log(f"连续签到天数: {self.sign_days}", "info")
                else:
                    self.log("无法获取连续签到天数", "warning")
                
                return True
            else:
                self.log(f"获取首页失败，状态码: {response.status_code}", "error")
        except Exception as e:
            self.log(f"获取用户信息时出错: {str(e)}", "error")
        return False

    def sign_in(self):
        """执行签到操作 - 处理已签到情况"""
        sign_url = "https://www.ablesci.com/user/sign"
        headers = self.headers.copy()
        headers["Referer"] = "https://www.ablesci.com/"
        
        try:
            response = self.session.get(sign_url, headers=headers, timeout=30)
            if response.status_code == 200:
                try:
                    result = response.json()
                    if result.get("code") == 0:
                        msg = result.get("msg", "").replace("签到成功，", "", 1)
                        self.log(f"签到成功: {result.get('msg')}", "success")
                        
                        data = result.get("data", {})
                        if data:
                            if "points" in data:
                                self.points = data["points"]
                                self.log(f"更新积分: {self.points}", "info")
                            if "sign_days" in data:
                                self.sign_days = data["sign_days"]
                                self.log(f"更新连续签到天数: {self.sign_days}", "info")
                        return True
                    else:
                        msg = result.get('msg', '')
                        if "您今天已于" in msg:
                            msg = result.get("msg", "").replace("签到失败，", "", 1)
                            self.log(f"今日已签到: {msg}", "info")
                            return True
                        else:
                            self.log(f"签到失败: {msg}", "error")
                except json.JSONDecodeError:
                    self.log("签到响应不是有效的JSON", "error")
            else:
                self.log(f"签到请求失败，状态码: {response.status_code}", "error")
        except Exception as e:
            self.log(f"签到过程中出错: {str(e)}", "error")
        return False

    def display_summary(self, is_before_sign=False):
        """显示执行摘要"""
        elapsed = round(time.time() - self.start_time, 2)
        title = "签到前信息" if is_before_sign else "签到后信息"
        self.log("=" * 50)
        self.log(f"用户 {protect_privacy(self.username)} {title}:")
        if self.username:
            self.log(f"  • 用户名: {protect_privacy(self.username)}")
        if self.points:
            self.log(f"  • 当前积分: {self.points}")
        if self.sign_days:
            self.log(f"  • 连续签到: {self.sign_days}天")
        self.log(f"  • 执行耗时: {elapsed}秒")
        self.log("=" * 50)
        self.log("")

    def run(self):
        """执行完整的登录和签到流程"""
        if self.login():
            self.get_user_info()
            self.display_summary(is_before_sign=True)
            
            sign_result = self.sign_in()
            
            if sign_result:
                self.log("签到完成，刷新用户信息...", "info")
                time.sleep(2)
                self.get_user_info()
                self.display_summary(is_before_sign=False)
        
        return self.notifier.get_content()

def get_accounts():
    """从环境变量获取所有账号"""
    accounts_env = os.getenv(ENV_ACCOUNTS)
    if not accounts_env:
        return []
    
    # 为保护账号密码，不在日志中输出 ABLESCI_ACCOUNTS 原文
    
    accounts = []
    # 支持换行符、分号、逗号分隔
    for line in accounts_env.splitlines():
        line = line.strip()
        if not line:
            continue
        if ";" in line:
            accounts.extend(line.split(";"))
        elif "," in line:
            accounts.extend(line.split(","))
        else:
            accounts.append(line)
    
    valid_accounts = []
    for account in accounts:
        account = account.strip()
        if not account:
            continue
        # 支持邮箱和密码用冒号、分号或竖线分隔
        if ":" in account:
            email, password = account.split(":", 1)
        elif ";" in account:
            email, password = account.split(";", 1)
        elif "|" in account:
            email, password = account.split("|", 1)
        else:
            print(f"警告：跳过格式错误的账号项: {account}")
            continue
            
        email = email.strip()
        password = password.strip()
        if email and password:
            valid_accounts.append((email, password))
        else:
            print(f"警告：账号或密码为空: {email}:{password}")
    
    return valid_accounts

def main():
    """主函数，处理多账号签到，统一通知器"""
    # 创建全局通知器，所有账号共享
    global_notifier = Notifier("科研通多账号签到")
    global_notifier.log("科研通多账号签到任务开始", "info")
    
    accounts = get_accounts()
    account_count = len(accounts)
    
    if account_count == 0:
        global_notifier.log("未找到有效的账号配置", "error")
        global_notifier.log(f"请设置环境变量 {ENV_ACCOUNTS}，格式为：邮箱1:密码1[换行]邮箱2:密码2", "warning")
        if global_notifier.notify_enabled:
            global_notifier.send_notification()
        return
    
    global_notifier.log(f"找到 {account_count} 个账号", "info")
    
    for i, (email, password) in enumerate(accounts, 1):
        global_notifier.log(f"\n===== 开始处理第 {i}/{account_count} 个账号 =====", "info")
        
        automator = AbleSciAuto(email, password, notifier=global_notifier)
        automator.run()
        
        global_notifier.log(f"===== 完成第 {i}/{account_count} 个账号处理 =====", "info")
    
    global_notifier.log("\n===== 所有账号处理完成 =====", "info")
    
    if global_notifier.notify_enabled:
        global_notifier.send_notification()
    
    if os.getenv("GITHUB_ACTIONS") == "true":
        github_output = os.getenv("GITHUB_OUTPUT")
        if github_output:
            content = global_notifier.get_content()
            with open(github_output, "a", encoding="utf-8") as f:
                f.write("log_content<<ABLESCI_EOF\n")
                f.write(content)
                f.write("\nABLESCI_EOF\n")

if __name__ == "__main__":
    main()
