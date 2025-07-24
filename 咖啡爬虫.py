import requests
import pandas as pd
from tqdm import tqdm
import time
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from urllib3.exceptions import MaxRetryError
import json
from concurrent.futures import ThreadPoolExecutor
import threading
import random

# 替换为你自己的高德 API Key
API_KEY = "9a0e2d873a2bc58ea83be1b88f483020"

# 搜索关键词列表
KEYWORDS = ["咖啡", "咖啡厅", "星巴克", "瑞幸咖啡", "咖啡馆", "COSTA","cafe","coffee"]

# 广东省城市列表
cities = [
    "广州", "深圳", "珠海", "汕头", "佛山", "韶关", "湛江", "肇庆", 
    "江门", "茂名", "惠州", "梅州", "汕尾", "河源", "阳江", "清远", 
    "东莞", "中山", "潮州", "揭阳", "云浮"
]

# 线程锁，用于安全的数据追加和请求控制
data_lock = threading.Lock()
request_lock = threading.Lock()
last_request_time = 0
all_data = []

def add_data_safely(shops):
    """线程安全地添加数据"""
    global all_data
    with data_lock:
        all_data.extend(shops)

def wait_for_next_request():
    """控制请求频率"""
    global last_request_time
    with request_lock:
        current_time = time.time()
        if last_request_time > 0:
            # 确保请求间隔至少1秒，随机增加0-1秒延迟
            elapsed = current_time - last_request_time
            if elapsed < 1.0:
                delay = 1.0 - elapsed + random.random()
                time.sleep(delay)
        last_request_time = time.time()

def get_district_list(city, key):
    """获取城市的区域列表"""
    url = "https://restapi.amap.com/v3/config/district"
    params = {
        "key": key,
        "keywords": city,
        "subdistrict": 1,  # 返回下一级行政区
        "extensions": "all"
    }
    try:
        response = requests.get(url, params=params)
        data = response.json()
        if data["status"] == "1" and data["districts"]:
            # 获取城市边界
            city_bounds = data["districts"][0]["polyline"]
            # 获取下级区域
            districts = [d["name"] for d in data["districts"][0]["districts"]]
            return districts, city_bounds
    except Exception as e:
        print(f"获取{city}区域列表失败: {str(e)}")
    return [], ""

def parse_polygon(polyline):
    """解析边界坐标串，返回经纬度范围"""
    if not polyline:
        return None
    
    coordinates = []
    try:
        # 处理多个多边形的情况
        for polygon in polyline.split("|"):
            # 处理每个多边形的点
            for point in polygon.split(";"):
                if "," not in point:
                    continue
                lng, lat = map(float, point.split(","))
                coordinates.append((lng, lat))
    except Exception as e:
        print(f"解析边界坐标出错: {str(e)}")
        return None
    
    if not coordinates:
        return None
        
    lngs = [c[0] for c in coordinates]
    lats = [c[1] for c in coordinates]
    
    return {
        "min_lng": min(lngs),
        "max_lng": max(lngs),
        "min_lat": min(lats),
        "max_lat": max(lats)
    }

def generate_grids(bounds, grid_size=0.1):  # 增大网格大小为0.1度
    """生成网格搜索范围"""
    if not bounds:
        return []
        
    grids = []
    lng_start = bounds["min_lng"]
    while lng_start < bounds["max_lng"]:
        lng_end = min(lng_start + grid_size, bounds["max_lng"])
        
        lat_start = bounds["min_lat"]
        while lat_start < bounds["max_lat"]:
            lat_end = min(lat_start + grid_size, bounds["max_lat"])
            
            grid = f"{lng_start},{lat_start}|{lng_end},{lat_end}"
            grids.append(grid)
            
            lat_start = lat_end
        lng_start = lng_end
    
    return grids

def get_coffee_shops(city, key, district="", polygon=""):
    """获取咖啡店数据"""
    # 设置重试策略
    retry_strategy = Retry(
        total=3,  # 减少重试次数
        backoff_factor=2,  # 增加重试等待时间
        status_forcelist=[500, 502, 503, 504],
    )
    adapter = HTTPAdapter(max_retries=retry_strategy)
    session = requests.Session()
    session.mount("https://", adapter)
    session.mount("http://", adapter)

    shops = []
    seen_shops = set()  # 用于去重

    # 对每个关键词进行搜索
    for keyword in KEYWORDS:
        page = 1
        no_new_data_count = 0  # 连续无新数据的次数
        error_count = 0  # 错误计数
        
        while page <= 100:  # 最大100页
            try:
                # 控制请求频率
                wait_for_next_request()
                
                url = "https://restapi.amap.com/v3/place/text"
                params = {
                    "key": key,
                    "keywords": keyword,
                    "city": city,
                    "output": "json",
                    "offset": 25,
                    "page": page,
                    "extensions": "all"
                }
                
                # 如果指定了区域，添加区域参数
                if district:
                    params["city"] = f"{city}"
                    params["keywords"] = f"{district} {keyword}"  # 添加空格分隔
                
                # 如果指定了多边形，添加多边形参数
                if polygon:
                    params["polygon"] = polygon
                
                response = session.get(url, params=params, timeout=10)
                data = response.json()
                
                if "status" in data and data["status"] != "1":
                    error_msg = data.get("info", "未知错误")
                    print(f"API错误 ({city}{district} - {keyword} 第{page}页): {error_msg}")
                    
                    if "LIMIT" in error_msg:  # 如果是限流错误
                        time.sleep(3 + random.random() * 2)  # 等待3-5秒
                        error_count += 1
                        if error_count >= 3:  # 连续3次限流就跳过当前关键词
                            print(f"连续遇到限流，跳过关键词: {keyword}")
                            break
                        continue
                    break

                pois = data.get("pois", [])
                if not pois:
                    break

                new_shops = 0
                for poi in pois:
                    # 使用ID去重
                    shop_id = poi.get("id", "")
                    if shop_id in seen_shops:
                        continue
                        
                    seen_shops.add(shop_id)
                    
                    # 处理经纬度数据
                    location = poi.get("location", "")
                    if isinstance(location, list):
                        location = ",".join(map(str, location))
                    
                    shop = {
                        "城市": city,
                        "区域": district or poi.get("adname", ""),
                        "店名": poi.get("name", ""),
                        "地址": poi.get("address", ""),
                        "电话": poi.get("tel", ""),
                        "类型": poi.get("type", ""),
                        "评分": poi.get("biz_ext", {}).get("rating", ""),
                        "营业时间": poi.get("biz_ext", {}).get("open_time", ""),
                        "品牌": keyword if keyword in ["星巴克", "瑞幸咖啡", "COSTA"] else "",
                        "经纬度": location,
                        "ID": shop_id
                    }
                    shops.append(shop)
                    new_shops += 1

                if new_shops == 0:
                    no_new_data_count += 1
                else:
                    no_new_data_count = 0
                    error_count = 0  # 重置错误计数

                # 如果连续3页没有新数据，切换关键词
                if no_new_data_count >= 3:
                    break
                    
                page += 1
                # 随机延迟1-2秒
                time.sleep(1 + random.random())

            except Exception as e:
                print(f"请求错误 ({city}{district} - {keyword} 第{page}页): {str(e)}")
                time.sleep(2)
                error_count += 1
                if error_count >= 3:
                    print(f"连续出错，跳过关键词: {keyword}")
                    break
                continue

    return shops

def process_grid(city, grid, key):
    """处理单个网格的数据"""
    shops = get_coffee_shops(city, key, polygon=grid)
    if shops:
        add_data_safely(shops)
    return len(shops)

def process_district(city, district, key):
    """处理单个区域的数据"""
    try:
        shops = get_coffee_shops(city, key, district=district)
        if shops:
            add_data_safely(shops)
            print(f"成功获取 {district} 的 {len(shops)} 条记录")
        return len(shops)
    except Exception as e:
        print(f"处理区域 {district} 时出错: {str(e)}")
        return 0

# 主程序：爬取所有城市数据
total_shops = 0
city_stats = {}

for city in tqdm(cities, desc="爬取城市"):
    try:
        print(f"\n{'='*50}")
        print(f"开始爬取 {city} 的数据...")
        city_count = 0
        
        # 1. 先直接爬取整个城市
        print(f"\n1. 正在直接爬取{city}的数据...")
        shops = get_coffee_shops(city, API_KEY)
        add_data_safely(shops)
        initial_count = len(shops)
        city_count += initial_count
        print(f"直接搜索获得 {initial_count} 条记录")
        
        # 2. 获取城市区域列表
        print(f"\n2. 获取{city}的区域信息...")
        districts, _ = get_district_list(city, API_KEY)
        
        # 3. 如果有区域信息，按区域爬取（改用串行处理）
        if districts:
            print(f"\n3. 正在按区域爬取{city}的数据...")
            print(f"发现以下区域: {', '.join(districts)}")
            for district in districts:
                count = process_district(city, district, API_KEY)
                city_count += count
                time.sleep(1)  # 区域之间添加延迟

        city_stats[city] = city_count
        total_shops += city_count
        print(f"\n✅ {city} 爬取完成，获取到 {city_count} 条记录")
            
    except Exception as e:
        print(f"处理城市 {city} 时出错: {str(e)}")
        continue

# 数据去重和处理
print("\n正在处理数据...")
df = pd.DataFrame(all_data)

# 清理空值
df = df.fillna('')

# 修复经纬度列的数据类型问题
def fix_location_column(location):
    """修复经纬度列的数据类型"""
    if isinstance(location, list):
        return ",".join(map(str, location))
    elif location is None or pd.isna(location):
        return ""
    else:
        return str(location)

# 应用修复函数
df["经纬度"] = df["经纬度"].apply(fix_location_column)

# 确保所有列都是字符串类型，避免unhashable type错误
string_columns = ["店名", "地址", "经纬度", "ID", "城市", "区域"]
for col in string_columns:
    if col in df.columns:
        df[col] = df[col].astype(str)

# 去重（先按ID去重，再按组合键去重）
print(f"去重前数据量: {len(df)}")

# 第一步：按ID去重
df_dedup_by_id = df.drop_duplicates(subset=["ID"], keep='first')
print(f"按ID去重后: {len(df_dedup_by_id)}")

# 第二步：对于没有ID或ID为空的数据，按组合键去重
mask_no_id = (df_dedup_by_id["ID"] == "") | (df_dedup_by_id["ID"] == "nan") | df_dedup_by_id["ID"].isna()
df_with_id = df_dedup_by_id[~mask_no_id]
df_without_id = df_dedup_by_id[mask_no_id]

if len(df_without_id) > 0:
    df_without_id_dedup = df_without_id.drop_duplicates(subset=["店名", "地址", "经纬度"], keep='first')
    df_final = pd.concat([df_with_id, df_without_id_dedup], ignore_index=True)
else:
    df_final = df_with_id

print(f"最终去重后数据量: {len(df_final)}")

# 按城市和区域排序
df_final = df_final.sort_values(by=["城市", "区域", "店名"])

# 保存到 CSV
output_file = "广东咖啡店信息.csv"
df_final.to_csv(output_file, index=False, encoding="utf-8-sig")
print(f"\n✅ 已保存为 {output_file}，共 {len(df_final)} 条记录")

# 打印统计信息
print("\n数据统计:")
print(f"总店铺数: {len(df_final)}")

print("\n按城市统计:")
city_stats = df_final.groupby("城市")["店名"].count().sort_values(ascending=False)
print(city_stats)

print("\n按区域统计:")
district_stats = df_final.groupby(["城市", "区域"])["店名"].count().sort_values(ascending=False)
print(district_stats)

# 打印品牌统计
print("\n按品牌统计:")
brand_stats = df_final[df_final['品牌'].ne('')].groupby(["城市", "品牌"])["店名"].count().sort_values(ascending=False)
print(brand_stats if not brand_stats.empty else "没有品牌数据")

# 输出评分统计
print("\n评分统计:")
df_final["评分"] = pd.to_numeric(df_final["评分"], errors="coerce")
rating_stats = df_final.groupby("城市")["评分"].agg(['mean', 'min', 'max']).round(2)
print(rating_stats)

# 保存统计结果
stats_file = "广东咖啡店统计.csv"
with open(stats_file, "w", encoding="utf-8-sig") as f:
    f.write("广东省咖啡店数据统计报告\n\n")
    
    f.write("1. 总体统计\n")
    f.write(f"总店铺数: {len(df_final)}\n\n")
    
    f.write("2. 城市统计\n")
    f.write(city_stats.to_string())
    f.write("\n\n")
    
    f.write("3. 区域统计\n")
    f.write(district_stats.to_string())
    f.write("\n\n")
    
    f.write("4. 品牌统计\n")
    f.write(brand_stats.to_string() if not brand_stats.empty else "没有品牌数据")
    f.write("\n\n")
    
    f.write("5. 评分统计\n")
    f.write(rating_stats.to_string())

print(f"\n✅ 统计报告已保存为 {stats_file}")

# 输出一些示例数据
print("\n数据示例:")
print(df_final[["城市", "区域", "店名", "地址", "评分"]].head())