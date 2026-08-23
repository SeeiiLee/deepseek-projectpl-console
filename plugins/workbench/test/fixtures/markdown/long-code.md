# 长代码示例

```typescript
export function computeScore(entries: readonly IntakeEntry[]): ScoreResult {
  const total = entries.reduce((sum, entry) => sum + entry.amount * entry.score, 0)
  const breakdown = entries.map(entry => ({
    label: entry.label,
    ratio: entry.amount * entry.score / Math.max(total, 1),
  }))
  return { total, breakdown, generatedAt: new Date().toISOString() }
}
```

```python
def parse_report(path: Path) -> dict:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("#"):
            continue
        rows.append(line.strip())
    return {"rows": rows, "count": len(rows)}
```
