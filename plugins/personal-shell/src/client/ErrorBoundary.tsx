import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface ErrorBoundaryProps { children: ReactNode }
interface ErrorBoundaryState { error: Error | null }

/**
 * 面板级错误边界：任何子插件渲染崩溃只影响本面板，并显示错误信息，
 * 而不是把整个 Gate-1 网格（连同工作台）一起卸载。
 */
export class PanelErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[personal-shell] panel crashed:', error, info.componentStack)
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children
    return (
      <div
        className="panel-crash"
        data-personal-boundary-fallback
        role="alert"
        style={{ padding: 16, color: '#c0392b', fontSize: 13, overflow: 'auto' }}
      >
        <strong>此面板发生错误，已隔离（其余界面不受影响）。</strong>
        <p style={{ whiteSpace: 'pre-wrap' }}>{String(this.state.error?.message ?? this.state.error)}</p>
        <button
          type="button"
          style={{ marginTop: 8 }}
          onClick={() => { this.setState({ error: null }) }}
        >
          重试
        </button>
      </div>
    )
  }
}
