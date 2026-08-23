# Markdown 走查测试文档

> 用途：Workbench R-PV1 排版与安全行为人工走查样本（插件开发结束即废弃）。
> 打开方式：开发版 → 右侧文件树 → 打开本文件（默认预览模式）。

## 一、中文与英文混排

这是一段中文正文，用于检查混排行高与断行：基因检测报告中的指标解读需要**清晰**、*易读*，并支持 English technical terms 混排，例如 MTHFR、C677T、rs1801133。长英文路径或 URL 允许断行：https://example.com/a/very/long/path/segment/that/should/wrap/gracefully/inside/the/reading/column.html

~~删除线文本~~ 与行内代码 `npm run check:plugins` 均应正常显示。

## 二、数学公式（KaTeX）

行内公式：$E = mc^2$ 与 $\alpha + \beta = \gamma$。

块级公式：

$$
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}
$$

积分与矩阵：

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi} \quad \text{与} \quad
\begin{pmatrix} a & b \\ c & d \end{pmatrix}
$$

## 三、GFM 表格与任务列表

| 指标 | 参考范围 | 单位 | 说明 |
| ---- | -------- | ---- | ---- |
| 同型半胱氨酸 | 5–15 | μmol/L | 心血管风险 |
| 维生素 B12 | 200–900 | pg/mL | 营养状态 |
| 维生素 D | 30–100 | ng/mL | 骨骼与免疫 |
| 叶酸 | 5.4–24 | ng/mL | 孕期关键指标 |

- [x] 完成营养标签解析
- [x] 完成摄入量评分
- [ ] 完成报告导出
- [ ] 完成个性化建议生成

## 四、嵌套列表与脚注

1. 第一层项目 A
   1. 第二层 A-1
   2. 第二层 A-2
2. 第一层项目 B
   - 无序子项 B-1
   - 无序子项 B-2

这里有一个脚注引用[^1]，还有第二个[^2]。

[^1]: 脚注定义一：包含 *markdown* 与 `inline code`，用于验证脚注区排版。
[^2]: 脚注定义二：支持中文标点与数字编号。

## 五、代码块（Shiki 高亮 + 复制按钮）

```typescript
export function computeScore(entries: readonly IntakeEntry[]): ScoreResult {
  const total = entries.reduce((sum, entry) => sum + entry.amount * entry.score, 0)
  const breakdown = entries.map(entry => ({
    label: entry.label,
    ratio: entry.amount * entry.score / Math.max(total, 1),
    source: entry.source ?? 'unknown',
  }))
  return { total, breakdown, generatedAt: new Date().toISOString() }
}
```

```python
def parse_report(path: Path) -> dict:
    """Parse a gene report into structured rows (fixture only)."""
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("#") or not line.strip():
            continue
        rows.append(line.strip())
    return {"rows": rows, "count": len(rows)}
```

未知语言代码块应回退为纯文本：

```customlang
this is a plain fallback block
```

## 六、安全边界（raw HTML 与危险链接）

以下 raw HTML **应显示为文字，不执行**：

<script>alert('xss')</script>

<img src="x" onerror="alert('xss')">

以下危险/受限链接**不可点击**：

- [javascript 链接](javascript:alert(1))
- [file 协议](file:///C:/Windows/win.ini)
- [相对链接](./another.md)
- [data 协议](data:text/html,<script>alert(1)</script>)

以下**正常链接应可点击**（新窗口或外部打开）：

- [https 普通链接](https://example.com)
- [github](https://github.com)

## 七、远程图片（触发「可能联网加载」提示）

![远程示意图](https://picsum.photos/600/300)

> 期望：文档顶部出现一次「该文档包含远程内容，可能联网加载」提示；图片按 no-referrer 加载；Viewer 关闭后 Blob/网络资源不残留。

## 八、引用块与分隔线

> 引用块用于验证左边线与次级文字颜色。多行引用可以**包含** `行内代码` 与 $x^2$。

---

水平线以上用于验证分隔线样式。

## 九、Unicode 路径与特殊字符

中文路径示例：`F:\项目\食溯\文档\需求.md`、`/home/用户/文档/说明.md`。

全角标点：逗号，句号、顿号；书名号《说明书》；破折号——以及省略号……

行内代码中的零宽字符：`a​b`（a 与 b 之间是 U+200B，应保持原样不渲染为空）。

## 十、宽内容（全屏分级走查）

下面的表格比阅读列更宽，全屏时应占满容器（不受 680px 阅读列限制），可横向滚动：

| 项目 | 阶段 | 状态 | 负责人 | 里程碑 | 备注 | 优先级 | 预估工时 | 依赖 | 风险 | 验收标准 | 实际工时 |
| ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| A | 设计 | 完成 | 甲 | M1 | 评审通过 | P0 | 8h | 无 | 低 | 文档冻结 | 9h |
| B | 开发 | 进行中 | 乙 | M2 | 依赖 A | P1 | 24h | A | 中 | 测试全绿 | 未结 |
| C | 测试 | 未开始 | 丙 | M3 | 待 B | P2 | 16h | B | 高 | 冒烟通过 | 未结 |
| D | 发布 | 未开始 | 丁 | M4 | 待 C | P1 | 4h | C | 中 | 包体校验 | 未结 |

长代码块（全屏时应占满容器宽度）：

```python
def very_long_function_name_that_should_trigger_horizontal_scroll_in_narrow_panel(parameter_one, parameter_two, parameter_three, parameter_four, parameter_five, parameter_six):
    return {
        "first": parameter_one + parameter_two,
        "second": parameter_three - parameter_four,
        "third": parameter_five * parameter_six,
        "comment": "this line is intentionally very long to verify horizontal scrolling behavior inside code blocks",
    }
```
