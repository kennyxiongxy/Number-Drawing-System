---
name: web-lottery-system-plan
overview: 开发一个单文件网页版在线抽号系统，用于课堂投影随机抽取小组发言，包含参数设置、滚动动效、庆祝动画、防重复、重置功能。
design:
  architecture:
    framework: html
  styleKeywords:
    - Minimalism
    - High Contrast
    - Classroom Projection
    - Centered Large Typography
    - Micro-animation
  fontSystem:
    fontFamily: Noto Sans
    heading:
      size: 48px
      weight: 700
    subheading:
      size: 28px
      weight: 600
    body:
      size: 18px
      weight: 400
  colorSystem:
    primary:
      - "#2563EB"
      - "#1D4ED8"
    background:
      - "#F8FAFC"
      - "#FFFFFF"
    text:
      - "#0F172A"
      - "#475569"
    functional:
      - "#10B981"
      - "#EF4444"
      - "#F59E0B"
todos:
  - id: design-ui
    content: 使用 [skill:frontend-design] 设计抽号系统界面与动效方案
    status: completed
  - id: create-index
    content: 创建单文件 index.html，实现参数设置、状态与样式
    status: completed
    dependencies:
      - design-ui
  - id: implement-draw
    content: 实现抽号随机逻辑、数字滚动动画与防重复机制
    status: completed
    dependencies:
      - create-index
  - id: add-celebration
    content: 接入庆祝彩带动画与结果放大闪烁效果
    status: completed
    dependencies:
      - implement-draw
  - id: test-reset
    content: 测试重置、边界校验和投影可读性，输出最终文件
    status: completed
    dependencies:
      - add-celebration
---

## 产品概述

开发一个网页版在线抽号系统，用于课堂随机抽取小组发言，避免人工点名遗漏，保证公平性。

## 核心功能

- **参数设置**：通过输入框设置“总小组数”和“每次抽取的组数”。
- **抽号动效**：点击抽号后，界面显示快速滚动的数字切换效果，持续约1-2秒。
- **庆祝动画**：抽号结束后，在界面中央弹出抽中号码，并触发简短醒目的庆祝动画（如彩带飘落、放大闪烁）。
- **防重复机制**：已抽中的小组自动排除，确保不重复抽取，直到所有组都被抽过；同时清晰展示剩余未抽取的组号。
- **重置功能**：一键重置按钮，清空当前记录，开始新一轮抽号。
- **界面设计**：简洁直观，适合课堂投影，数字大且清晰。

## 技术栈

- **前端**：纯 HTML5 + CSS3 + 原生 JavaScript（单文件，无需构建工具）
- **动画**：Canvas Confetti（CDN 引入）用于庆祝动画，CSS 关键帧动画用于数字滚动与放大闪烁
- **样式**：原生 CSS + 响应式布局，针对投影大屏幕优化字体和对比度

## 实现方案

采用单文件单页应用，核心逻辑按模块分离：

1. **状态管理**：维护总组数、每次抽取组数、剩余未抽组号、已抽中记录。
2. **渲染层**：根据状态更新控制面板、剩余组号、抽号按钮、结果展示。
3. **动画层**：使用 `requestAnimationFrame` 实现数字快速滚动，1.2秒后停止并揭示结果；抽中号码弹出时使用 CSS 放大 + 闪烁。
4. **庆祝层**：抽号结束后调用 `confetti()` 实现 1 秒左右的彩带飘落，增强课堂氛围。

## 实现细节

- **随机抽取**：从剩余组号中随机选取指定数量，避免重复；每次抽取后更新剩余列表。
- **输入校验**：总组数与每次抽取数需为正整数，每次抽取数不超过剩余组数。
- **投影适配**：主号码字号 12vw 以上，确保远距离清晰可见；使用高对比度配色。
- **无障碍**：按钮具备清晰文案，动画不干扰核心操作。

## 架构设计

```
页面入口 (index.html)
├── 控制面板：输入框 + 抽号按钮 + 重置按钮
├── 动画展示区：滚动数字 / 抽中结果
├── 状态面板：剩余未抽取组号、已抽取记录
└── 庆祝层：canvas-confetti 覆盖层
```

## 目录结构

```
/Users/yaoxiong/Downloads/app-dev/在线抽号系统/
├── index.html    # [NEW] 单文件应用，包含 HTML、CSS、JavaScript
└── README.md     # [NEW] 使用说明（可选，便于课堂快速上手）
```

## 设计风格

采用适合课堂投影的简洁、高对比度、极简现代风格。界面以中心大数字为核心，周围控制与状态信息清晰排布。整体保持低干扰，避免花哨元素分散学生注意力，同时通过动画提升仪式感和公平感。

## 页面布局

- 顶部：简洁标题与重置按钮
- 中部：大数字展示区，用于滚动动画和最终结果
- 底部：参数设置、剩余组号、已抽中记录
- 覆盖层：抽号结束时的庆祝彩带

## 交互

- 抽号按钮突出，点击后数字快速滚动，随后定格并弹出结果
- 结果弹出时伴随放大闪烁动画，庆祝彩带飘落
- 剩余组号实时更新，清晰可见
- 重置按钮一键恢复初始状态

## 使用到的扩展

- **Skill: frontend-design**
- 用途：为抽号系统设计高质量、适合课堂投影的界面，避免通用 AI 风格，提升视觉表现力。
- 预期成果：输出包含配色、布局、动画建议的 UI 方案，并据此编写 HTML/CSS 代码。