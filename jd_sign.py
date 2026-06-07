import os
import requests
import json
from datetime import datetime

# 获取环境变量中的 Cookie
jd_cookie = os.getenv('JD_COOKIE')
if not jd_cookie:
    print("未配置京东 Cookie！请确保环境变量 JD_COOKIE 已设置。")
    exit(1)

# 统一设备信息 (这里以一个真实的 iOS UA 为例，需与 params 中的 client: apple 对应)
USER_AGENT = 'jdapp;iPhone;10.0.4;14.4;network/wifi;Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148;supportJDSHWK/1'

# 请求头配置
headers = {
    'User-Agent': USER_AGENT,
    'Cookie': jd_cookie,
    'Referer': 'https://api.m.jd.com/',
    'Content-Type': 'application/x-www-form-urlencoded'
}

def jd_sign():
    """京东首页签到"""
    try:
        url = 'https://api.m.jd.com/client.action'
        
        # 尽量模拟真实的参数，但注意：缺少真实的 h5st 签名依然可能失败
        params = {
            'functionId': 'signBeanAct',
            'appid': 'ld',
            'clientVersion': '10.0.4',
            'client': 'apple',
            'body': json.dumps({"rnVersion": "3.9"}) # 将 body 格式化为正确的 JSON 字符串
        }
        
        response = requests.get(url, headers=headers, params=params, timeout=10)
        
        # 检查 HTTP 状态码
        response.raise_for_status() 
        
        # 安全地解析 JSON
        try:
            result = response.json()
        except ValueError:
            print(f"{datetime.now()} - 签到失败：返回内容不是有效的 JSON。可能已被拦截或 Cookie 失效。")
            return
            
        if str(result.get('code')) == '0':
            print(f"{datetime.now()} - 签到成功！{result.get('data', {}).get('signAwardMessage', '获得京豆')}")
        else:
            # 京东的错误信息有时在 errorMessage 里
            err_msg = result.get('errorMessage') or result.get('echo') or '未知错误'
            print(f"{datetime.now()} - 签到失败或重复签到：{err_msg} (返回码: {result.get('code')})")
            
    except requests.exceptions.RequestException as e:
        print(f"{datetime.now()} - 网络请求异常：{str(e)}")
    except Exception as e:
        print(f"{datetime.now()} - 发生未知异常：{str(e)}")

def jd_daily_task():
    """执行其他每日任务（示例）"""
    print(f"{datetime.now()} - 准备执行每日任务...")
    # TODO: 添加具体任务逻辑

if __name__ == "__main__":
    print("开始执行京东签到任务...")
    jd_sign()
    jd_daily_task()
    print("京东签到任务执行完成！")
