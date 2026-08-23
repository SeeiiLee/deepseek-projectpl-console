/**
 * R-ED Phase 1：斜杠命令菜单。
 * 使用 @tiptap/suggestion 监听 '/'，弹出常用 Markdown 块命令。
 * 渲染采用轻量 DOM（不引入 tippy.js），随光标定位。
 */
import { Extension, type Editor } from '@tiptap/core'
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'

export interface SlashCommandItem {
  title: string
  keywords: string[]
  command: (editor: Editor) => void
}

interface SlashInputField {
  key: string
  label: string
  placeholder?: string
  defaultValue?: string
  /** 提供“选择本地文件/图片”按钮，选中后自动填充路径/名称。 */
  pick?: 'file' | 'image'
}

/** 从拖放/选择的 File 对象尽力取本地路径（优先用 preload 暴露的 webUtils.getPathForFile）。 */
function filePathOf(file: File): string {
  try {
    const bridge = (window as unknown as { deepseekHarnessPersonal?: { desktop?: { getPathForFile?: (f: File) => string } } }).deepseekHarnessPersonal?.desktop
    const resolved = bridge?.getPathForFile?.(file)
    if (typeof resolved === 'string' && resolved !== '') return resolved.replace(/\\/gu, '/')
  } catch {
    // ignore
  }
  const withPath = file as File & { path?: string }
  if (typeof withPath.path === 'string' && withPath.path !== '') {
    return withPath.path.replace(/\\/gu, '/')
  }
  return './' + file.name
}

/** Electron 不支持 window.prompt，斜杠命令需要输入时用这个轻量输入弹层。 */
function showSlashInput(options: {
  title: string
  fields: SlashInputField[]
  onConfirm(values: Record<string, string>, files: Record<string, File>): void
}): void {
  const overlay = document.createElement('div')
  overlay.className = 'dsh-slash-input-overlay'
  const panel = document.createElement('div')
  panel.className = 'dsh-slash-input'
  const title = document.createElement('div')
  title.className = 'dsh-slash-input-title'
  title.textContent = options.title
  panel.appendChild(title)
  const inputs: HTMLInputElement[] = []
  const pickedFiles: Record<string, File> = {}
  for (const field of options.fields) {
    const label = document.createElement('label')
    label.textContent = field.label
    const input = document.createElement('input')
    input.type = 'text'
    input.placeholder = field.placeholder ?? ''
    input.value = field.defaultValue ?? ''
    inputs.push(input)
    label.appendChild(input)
    if (field.pick !== undefined) {
      const pickButton = document.createElement('button')
      pickButton.type = 'button'
      pickButton.textContent = field.pick === 'image' ? '选择本地图片…' : '选择本地文件…'
      const fileInput = document.createElement('input')
      fileInput.type = 'file'
      fileInput.accept = field.pick === 'image' ? 'image/*' : ''
      fileInput.style.display = 'none'
      pickButton.addEventListener('click', () => { fileInput.click() })
      fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0]
        if (file === undefined) return
        pickedFiles[field.key] = file
        const path = filePathOf(file)
        if (field.pick === 'image') {
          input.value = path
        } else {
          // file 字段：把路径填进当前 input，并把“名称”字段也尽量填上文件名。
          input.value = path
          const nameInput = inputs[0]
          if (nameInput !== undefined && nameInput.value === '文件' || nameInput?.value === '') {
            nameInput.value = file.name
          }
        }
      })
      label.appendChild(pickButton)
      label.appendChild(fileInput)
    }
    panel.appendChild(label)
  }
  const actions = document.createElement('div')
  actions.className = 'dsh-slash-input-actions'
  const ok = document.createElement('button')
  ok.type = 'button'
  ok.textContent = '插入'
  ok.addEventListener('click', () => {
    const values: Record<string, string> = {}
    options.fields.forEach((field, index) => {
      values[field.key] = inputs[index]?.value ?? ''
    })
    overlay.remove()
    options.onConfirm(values, pickedFiles)
  })
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.textContent = '取消'
  cancel.addEventListener('click', () => { overlay.remove() })
  actions.appendChild(ok)
  actions.appendChild(cancel)
  panel.appendChild(actions)
  overlay.appendChild(panel)
  document.body.appendChild(overlay)
  inputs[0]?.focus()
}

const commands: SlashCommandItem[] = [
  { title: '正文', keywords: ['p', 'text', 'wb', 'zhwb'], command: editor => { editor.chain().focus().setParagraph().run() } },
  { title: 'H1 一级标题', keywords: ['h1', 'title', 'zbt'], command: editor => { editor.chain().focus().toggleHeading({ level: 1 }).run() } },
  { title: 'H2 二级标题', keywords: ['h2', 'dbt'], command: editor => { editor.chain().focus().toggleHeading({ level: 2 }).run() } },
  { title: 'H3 三级标题', keywords: ['h3', 'zhbt'], command: editor => { editor.chain().focus().toggleHeading({ level: 3 }).run() } },
  { title: 'H4 四级标题', keywords: ['h4', 'xbt'], command: editor => { editor.chain().focus().toggleHeading({ level: 4 }).run() } },
  { title: 'H5 五级标题', keywords: ['h5', 'wjbt'], command: editor => { editor.chain().focus().toggleHeading({ level: 5 }).run() } },
  { title: 'H6 六级标题', keywords: ['h6', 'ljbt'], command: editor => { editor.chain().focus().toggleHeading({ level: 6 }).run() } },
  { title: '无序列表', keywords: ['ul', 'wxlb', 'lb'], command: editor => { editor.chain().focus().toggleBulletList().run() } },
  { title: '有序列表', keywords: ['ol', 'szlb'], command: editor => { editor.chain().focus().toggleOrderedList().run() } },
  { title: '待办列表', keywords: ['todo', 'dblb'], command: editor => { editor.chain().focus().toggleTaskList().run() } },
  { title: '引用', keywords: ['quote', 'yswz'], command: editor => { editor.chain().focus().toggleBlockquote().run() } },
  { title: '代码块', keywords: ['code', 'dmpd'], command: editor => { editor.chain().focus().toggleCodeBlock().run() } },
  { title: '分割线', keywords: ['hr', 'fgx'], command: editor => { editor.chain().focus().setHorizontalRule().run() } },
  { title: '表格', keywords: ['table', 'jdbg'], command: editor => { editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() } },
  { title: '链接', keywords: ['link', 'lj'], command: editor => {
    const url = window.prompt('链接地址（http/https/mailto）')
    if (url !== null && url.trim() !== '') editor.chain().focus().setLink({ href: url.trim() }).run()
  } },
  { title: '脚注', keywords: ['footnote', 'jz', 'jiaozhu'], command: editor => {
    const storage = editor.storage.footnote as { counter: number }
    const id = storage.counter
    storage.counter += 1
    const { to } = editor.state.selection
    const insertAt = Math.max(1, to)
    const footnoteNode = editor.schema.nodes.footnote?.create({ id })
    if (footnoteNode !== undefined) {
      editor.view.dispatch(editor.state.tr.replaceWith(insertAt, insertAt, footnoteNode))
    }
    let hasDefinition = false
    editor.state.doc.descendants(node => {
      if (node.type.name === 'footnoteDefinition') {
        hasDefinition = true
        return false
      }
      return true
    })
    let end = editor.state.doc.content.size
    if (!hasDefinition) {
      editor.chain().focus().insertContentAt(end, { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '脚注' }] }).run()
      end = editor.state.doc.content.size
    }
    const defNode = editor.schema.nodes.footnoteDefinition?.create({ id }, editor.schema.text(' 脚注内容'))
    if (defNode !== undefined) {
      editor.view.dispatch(editor.state.tr.replaceWith(end, end, defNode))
    }
    const docEnd = editor.state.doc.content.size
    editor.chain().focus().setTextSelection({ from: docEnd, to: docEnd }).scrollIntoView().run()
  } },
  { title: '行内公式', keywords: ['math', 'sxgs', 'hngs'], command: editor => {
    if (!editor.state.selection.empty) {
      editor.chain().focus().toggleMark('inlineMath').run()
      return
    }
    editor.chain().focus().insertContent([{ type: 'text', text: ' ', marks: [{ type: 'inlineMath' }] }]).run()
    const after = editor.state.selection.from
    editor.commands.setTextSelection({ from: after - 1, to: after - 1 })
  } },
  { title: '图片/媒体', keywords: ['image', 'media', 'tp', 'tpmeiti', 'tupian'], command: editor => {
    showSlashInput({
      title: '插入图片',
      fields: [
        { key: 'src', label: '图片地址', placeholder: 'https://… 或 ./images/a.png，也可点下方选择本地图片', defaultValue: 'https://picsum.photos/200', pick: 'image' },
        { key: 'alt', label: '图片说明（可选）', placeholder: '图片', defaultValue: '图片' },
      ],
      onConfirm: (values, files) => {
        const path = values.src?.trim() || 'https://picsum.photos/200'
        const file = files.src
        const src = file === undefined ? path : URL.createObjectURL(file)
        const dataPath = file === undefined ? null : path
        editor.chain().focus().insertContent({
          type: 'image',
          attrs: { src, alt: values.alt?.trim() || '图片', dataPath },
        }).run()
      },
    })
  } },
  { title: '文件/附件', keywords: ['file', 'attachment', 'wj', 'fujian'], command: editor => {
    showSlashInput({
      title: '插入文件/附件',
      fields: [
        { key: 'name', label: '文件显示名称', placeholder: '例如：需求文档', defaultValue: '文件' },
        { key: 'href', label: '文件路径或链接', placeholder: '项目内相对路径如 ./docs/需求.md；项目外绝对路径如 D:/资料/需求.md；或 https://…', defaultValue: './docs/文件', pick: 'file' },
      ],
      onConfirm: (values, files) => {
        const file = files.href
        const name = values.name?.trim() || (file?.name ?? '文件')
        const href = values.href?.trim() || (file === undefined ? './path' : filePathOf(file))
        editor.chain().focus().insertContent({
          type: 'fileAttachment',
          attrs: { name, href },
        }).run()
      },
    })
  } },
  { title: '数据库/表格视图', keywords: ['database', 'view', 'sj', 'shujuku', 'biaoge'], command: editor => {
    // 在当前命令位置插入“数据视图”标题 + 表格（不用 HTML 字符串，避免被当纯文本插入）。
    editor.chain().focus()
      .insertContent([
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: '数据视图' }] },
        { type: 'paragraph' },
      ])
      .run()
    editor.chain().focus()
      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
      .run()
  } },
]

function filterCommands(query: string): SlashCommandItem[] {
  const q = query.trim().toLowerCase()
  if (q === '') return commands
  return commands.filter(item =>
    item.title.toLowerCase().includes(q) ||
    item.keywords.some(keyword => keyword.includes(q)),
  ).slice(0, 12)
}

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        pluginKey: new PluginKey('slashCommand'),
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
        items: ({ query }) => filterCommands(query),
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run()
          props.command(editor)
        },
        render: () => {
          let element: HTMLDivElement | null = null
          let current: SuggestionProps<SlashCommandItem> | null = null
          let selected = 0

          const renderList = (): void => {
            if (element === null || current === null) return
            element.innerHTML = ''
            const items = current.items
            if (items.length === 0) {
              const empty = document.createElement('div')
              empty.className = 'empty'
              empty.textContent = '无匹配命令'
              element.appendChild(empty)
              return
            }
            selected = Math.min(selected, items.length - 1)
            // 直接捕获 editor/range 和 item.command，点击时手动执行，
            // 不依赖 Suggestion 的 current 在点击瞬间是否仍存在。
            const editor = current.editor
            const range = current.range
            for (let index = 0; index < items.length; index += 1) {
              const item = items[index]
              if (item === undefined) continue
              const button = document.createElement('button')
              button.type = 'button'
              button.textContent = item.title
              if (index === selected) button.className = 'selected'
              button.addEventListener('mousedown', event => {
                event.preventDefault()
                editor.chain().focus().deleteRange(range).run()
                item.command(editor)
              })
              button.addEventListener('mouseenter', () => {
                selected = index
                // 只更新高亮 class，不要重建整个列表，避免鼠标按下时按钮被替换导致点击丢失。
                if (element !== null) {
                  const buttons = Array.from(element.querySelectorAll('button'))
                  buttons.forEach((btn, btnIndex) => {
                    btn.className = btnIndex === selected ? 'selected' : ''
                  })
                }
              })
              element.appendChild(button)
            }
          }

          const position = (): void => {
            if (element === null || current === null) return
            const coords = current.editor.view.coordsAtPos(current.range.from)
            if (coords === null) return
            element.style.left = Math.max(8, coords.left) + 'px'
            element.style.top = (coords.bottom + 4) + 'px'
          }

          const onKeyDown = ({ event }: SuggestionKeyDownProps): boolean => {
            if (element === null || current === null) return false
            if (event.key === 'ArrowDown') {
              selected = (selected + 1) % Math.max(1, current.items.length)
              renderList()
              return true
            }
            if (event.key === 'ArrowUp') {
              selected = (selected - 1 + Math.max(1, current.items.length)) % Math.max(1, current.items.length)
              renderList()
              return true
            }
            if (event.key === 'Enter') {
              const item = current.items[selected]
              if (item !== undefined) {
                current.command(item)
                return true
              }
            }
            return false
          }

          return {
            onStart: props => {
              current = props
              element = document.createElement('div')
              element.className = 'dsh-slash-menu'
              document.body.appendChild(element)
              selected = 0
              renderList()
              position()
            },
            onUpdate: props => {
              current = props
              selected = 0
              renderList()
              position()
            },
            onExit: () => {
              element?.remove()
              element = null
              current = null
            },
            onKeyDown,
          }
        },
      }),
    ]
  },
})
