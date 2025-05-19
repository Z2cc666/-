

# 🗺️ Tourism Big Data Visualization Project

## 📌 Project Overview

This project presents a comprehensive **data visualization and analysis** of tourism data across China. Using **Python (Pandas + Pyecharts)**, we visualize various dimensions such as sales volume, scenic spot distribution, pricing, and holiday travel trends. The final output includes interactive charts and maps that aid tourism planning, decision-making, and public understanding of the tourism market structure.

## 📊 Key Features

* 📌 **Top 20 Most Popular Scenic Spots** — Horizontal bar chart based on ticket sales
* 🏞️ **City-Level 4A/5A Attractions Distribution** — Bar chart for city tourism resource density
* 🗺️ **National Map of High-Level Attractions** — Heat map showing spatial distribution
* 🌸 **Rose Charts** — Ticket price ranges & number of 4A/5A attractions per province
* 💬 **Word Cloud** — Scenic spot introduction highlights
* 🔍 **Scatter Plots** — Relationships between price levels, sales, and attraction quantity
* 🚗 **Holiday Travel Distribution** — Geographical distribution of tourist flow

## 🧾 Dataset Description

* **Format**: Excel (`.xlsm`)
* **Fields**: Name, City, Ticket Price, Grade (4A/5A), Sales, Description, Address
* **Preprocessing**:

  * Removed duplicates by scenic spot name
  * Filled missing grades and descriptions with mode/defaults
  * Divided ticket price into defined intervals using `pd.cut()`

## 🛠️ Technologies Used

* **Language**: Python 3.x
* **Libraries**:

  * `pandas`: Data handling and preprocessing
  * `pyecharts`: Interactive charts and maps
  * `matplotlib` & `seaborn`: Auxiliary visual checks
* **Output Format**: Interactive HTML reports

## 🔎 Data Mining Techniques

* **Preprocessing**:

  * Duplicate removal
  * Null value filling
  * Type normalization
* **Clustering**:

  * Price range segmentation
* **Aggregation**:

  * Scenic spot count per city
  * Grade-level distribution per region

## 📁 Project Structure

```
Tourism-Visualization/
├── data/
│   └── 旅游景点.xlsm
├── figures/
│   ├── top20_sales_bar.html
│   ├── city_grade_bar.html
│   └── ...
├── src/
│   └── main_visualization.py
├── README.md
└── requirements.txt
```

## 🚀 How to Run

1. Clone the repository:

   ```bash
   git clone https://github.com/yourusername/Tourism-Visualization.git
   cd Tourism-Visualization
   ```

2. Install dependencies:

   ```bash
   pip install -r requirements.txt
   ```

3. Run the visualization script:

   ```bash
   python src/main_visualization.py
   ```

4. Open the generated `.html` files in the `figures/` directory with any web browser.

## 📈 Sample Visualization

![Sample Chart](figures/sample_chart.png)

## 🙋 Author

* **Name**: Zhong Zhuohua
* **Major**: Computer Science and Technology 22(3)
* **College**: School of International Education
* **ID**: 3122010011
* **Instructor**: Prof. Lin Zhiyi

## 📅 Date

May 1, 2025

