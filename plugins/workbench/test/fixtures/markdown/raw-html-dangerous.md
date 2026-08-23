# 安全边界示例

raw HTML 应显示为文字而非执行：

<script>alert('xss')</script>

危险链接不应可点击：

[点击我](javascript:alert(1))

[相对链接](./other.md)

[危险图片](file:///C:/Windows/win.ini)

远程图片提示（仅提示，不阻断）：

![示意图](https://example.com/diagram.png)
