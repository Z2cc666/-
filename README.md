# 广东省咖啡店分布地图

## 项目简介
本项目通过高德地图 API 爬取广东省各城市的咖啡店数据，并基于 ECharts+Baidu Map 实现可视化。支持多城市、多维度筛选、聚类、热力图等多种交互功能，帮助用户直观了解广东省咖啡文化分布。

## 主要功能
- 支持多城市（可多选）筛选
- 区域、评分、品牌等多维度过滤
- 地图点聚合、热力图切换
- 咖啡店分布、评分分布、品牌分布等多种统计图表
- 响应式布局，适配不同屏幕
- 一键重置缩放、切换视图

## 文件结构
```
case03/
├── index.html         # 主页面，可视化入口
├── 广东咖啡店信息.csv   # 爬取的咖啡店原始数据
├── 广东咖啡店统计.csv   # 统计报表
├── 咖啡爬虫.py         # 数据爬虫脚本
├── server.py           # 本地 HTTP 服务脚本
└── README.md           # 项目说明
```

## 使用方法
### 1. 数据爬取
- 配置好高德地图 API KEY
- 运行 `咖啡爬虫.py`，自动爬取广东省所有城市和区县的咖啡店数据，生成 `广东咖啡店信息.csv`

### 2. 启动本地服务器
推荐用 Python3 自带的 HTTP 服务器：
```bash
cd case03
python3 server.py
```
或
```bash
python3 -m http.server 5500
```

### 3. 打开可视化页面
在浏览器访问：
```
http://127.0.0.1:5500
```
### 页面演示
<img width="1470" height="876" alt="截屏2025-07-24 上午10 28 15" src="https://github.com/user-attachments/assets/aeb049fb-16da-4e2c-becb-d049df5e774d" />
/case03/index.html

### 4. 交互说明
- 城市选择支持多选，支持 Select2 搜索
- 可按区域、评分、品牌等过滤
- 支持地图点聚合、热力图切换
- 支持多种统计
图表展示
<img width="294" height="325" alt="截屏2025-07-24 上午10 28 57" src="https://github.com/user-attachments/assets/deef9437-4fb5-4b7c-a10e-92fce63ca4d1" />
<img width="291" height="646" alt="截屏2025-07-24 上午10 28 43" src="https://github.com/user-attachments/assets/9d2b2f7c-1fe5-4346-b4c0-91a25c3585b4" />
<img width="273" height="326" alt="截屏2025-07-24 上午10 28 34" src="https://github.com/user-attachments/assets/294c2e0a-20ea-4717-9299-7bcb9dd06f6c" />
<img width="233" height="254" alt="截屏2025-07-24 上午10 28 27" src="https://github.com/user-attachments/assets/b8b4c4e8-591c-45f8-b7dd-55ffe14ff8b5" />
## 依赖说明
- [jQuery 3.6+](https://code.jquery.com/)
- [Select2 4.1+](https://select2.org/)
- [PapaParse](https://www.papaparse.com/)（CSV 解析）
- [ECharts 5+](https://echarts.apache.org/)
- [Baidu Map JS API](https://lbsyun.baidu.com/)
- [echarts-bmap 扩展](https://github.com/ecomfe/echarts-bmap)

所有依赖均通过 CDN 自动加载，无需本地安装。

## 常见问题
- **城市下拉无法多选/样式错乱**：请确保页面只存在一个 id="citySelect" 的 select 元素，且 Select2 已正确初始化。
- **数据加载失败/404**：请务必通过本地 HTTP 服务访问页面，不能直接用文件协议（file://）。
- **地图不显示/报 API KEY 错误**：请替换为你自己的百度地图 API KEY。
- **爬虫报错/数据不全**：请检查高德 API KEY 是否有效，或尝试降低爬取频率。

## 联系方式
如有问题或建议，欢迎 issue 或联系作者。 
