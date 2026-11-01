export type PathKey = string | number

/** 拍平后的一行（行高固定，虚拟滚动才能靠算的） */
export type TreeRow = {
  /** 路径的字符串形式，用作 v-for 的 key 和展开状态的键 */
  key_id: string
  key: PathKey
  depth: number
  parent: TreeRow | null
  /** 能否展开（对象或数组） */
  is_branch: boolean
  child_count: number
}

type NestedData = Record<string, unknown> | unknown[]

/**
 * 判断是不是「能展开」的容器
 * 注意要排除类型化数组：种子里的 pieces 是 Uint8Array，
 * 当成数组遍历会一个字节一行，几十万行直接把浏览器拖死
 */
export const is_branch_value = (value: unknown): value is NestedData => {
  if (Array.isArray(value)) return true
  return value !== null && typeof value === 'object' && !ArrayBuffer.isView(value)
}

const entries_of = (value: NestedData): [PathKey, unknown][] => {
  if (Array.isArray(value)) return value.map((item, index): [PathKey, unknown] => [index, item])
  return Object.entries(value)
}

const child_count_of = (value: NestedData): number => {
  return Array.isArray(value) ? value.length : Object.keys(value).length
}

/**
 * 按展开状态把树拍平成行列表
 * 只有展开的节点才会把自己的子节点压进结果，所以「收起」的子树完全不产生行
 * @param root 根值（传 toRaw 后的数据，避免给每一行都挂响应式依赖）
 * @param is_expanded 某个 key_id 是否处于展开状态
 */
export function build_rows(root: unknown, is_expanded: (key_id: string) => boolean): TreeRow[] {
  const rows: TreeRow[] = []
  if (!is_branch_value(root)) return rows

  type Pending = {
    value: unknown
    parent: TreeRow | null
    key: PathKey
    key_id: string
    depth: number
  }

  const stack: Pending[] = []

  // 用显式栈做深度优先，避免深层嵌套（v2 的 file tree）递归爆栈
  const push_children = (
    value: NestedData,
    parent: TreeRow | null,
    parent_key_id: string,
    depth: number,
  ) => {
    const entries = entries_of(value)

    // 逆序入栈，弹出时就是原始顺序
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]
      if (entry === undefined) continue

      const [key, child] = entry
      stack.push({
        value: child,
        parent,
        key,
        key_id: `${parent_key_id}\u0000${String(key)}`,
        depth,
      })
    }
  }

  push_children(root, null, '', 0)

  while (stack.length > 0) {
    const node = stack.pop()
    if (node === undefined) break

    // 先收窄成 NestedData，后面就不用反复断言了
    const branch_value = is_branch_value(node.value) ? node.value : null

    const row: TreeRow = {
      key_id: node.key_id,
      key: node.key,
      depth: node.depth,
      parent: node.parent,
      is_branch: branch_value !== null,
      child_count: branch_value === null ? 0 : child_count_of(branch_value),
    }

    rows.push(row)

    if (branch_value !== null && is_expanded(row.key_id))
      push_children(branch_value, row, row.key_id, node.depth + 1)
  }

  return rows
}

/** 从某一行反推出相对根节点的路径 */
export function path_of(row: TreeRow): PathKey[] {
  const path: PathKey[] = []

  for (let node: TreeRow | null = row; node !== null; node = node.parent) path.push(node.key)

  return path.reverse()
}

/**
 * 路径拼成字符串，用作「哪些字段被改过」的键。
 * 用 \u0000 分隔，真实的键名里不可能出现这个字符，不会拼出歧义
 */
export function path_key(path: PathKey[]): string {
  return path.join('\u0000')
}

/** 顺着路径取值；路径不存在时给 undefined，不抛错 */
export function get_by_path(root: unknown, path: PathKey[]): unknown {
  let value = root

  for (const key of path) {
    if (value === null || typeof value !== 'object') return undefined
    value = (value as Record<PathKey, unknown>)[key]
  }

  return value
}

/** 顺着路径写值；父层不是容器时静默跳过 */
export function set_by_path(root: unknown, path: PathKey[], newValue: unknown): void {
  if (path.length === 0) return

  const parent = get_by_path(root, path.slice(0, -1))
  const last_key = path.at(-1)

  if (last_key === undefined || parent === null || typeof parent !== 'object') return

  ;(parent as Record<PathKey, unknown>)[last_key] = newValue
}

/**
 * 输入框给的永远是字符串，写回时按原值的类型还原。
 * 数字字段如果存成字符串，bencode 会写出不合法的种子，
 * 而且「改回原值」也会因为 number !== string 一直算作改动、颜色退不掉
 */
export function parse_like(original: unknown, text: string): unknown {
  const trimmed = text.trim()

  if (typeof original === 'number' && /^-?\d+$/.test(trimmed)) return Number(trimmed)

  return text
}
