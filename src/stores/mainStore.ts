import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { Torrent } from '@/torrent'
import { path_key, set_by_path, type PathKey } from '@/tree'
import { base64_to_bytes, bytes_to_base64, set_local_store } from '@/utils'

type Torrent_data = {
  filename: string
  buffer_str: string
}

/** 一处改动：字段路径 + 改动前的值（还原时要用） */
type ChangeEntry = {
  path: PathKey[]
  before: unknown
}

/** 二进制编辑器弹窗的位置与大小，单位 px，left/top 相对视口左上角 */
export type DialogBox = {
  left: number
  top: number
  width: number
  height: number
}

// 字段路径拼成字符串，用作「哪些字段被改过」的键
const SEPARATOR = '\u0000'

// 二进制字段按字节比，其余按 Object.is；改动被原样改回去时就能自动取消高亮
function is_same_value(a: unknown, b: unknown): boolean {
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    if (a.length !== b.length) return false

    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false

    return true
  }

  return Object.is(a, b)
}

export const useMainStore = defineStore('mainStore', () => {
  const torrent_data_list = ref<Torrent_data[]>([])
  set_local_store(torrent_data_list, 'torrent_buffer_list')

  const torrent_list = ref<Torrent[]>(
    torrent_data_list.value.map((d) => new Torrent(base64_to_bytes(d.buffer_str), d.filename)),
  )

  // 已经写进存储的种子；不在这里面的就是本次新加的，同样算未保存
  const saved_torrents = ref(new Set<Torrent>(torrent_list.value))

  // 每个种子改过哪些字段：字段路径 → 改动记录
  const changed_fields = ref(new Map<Torrent, Map<string, ChangeEntry>>())
  // 增删种子也算未保存的改动
  const structure_dirty = ref(false)

  // 二进制编辑器弹窗的位置和大小放在这里，关掉弹窗再打开时接着用上次的
  // null 表示还没量过：下次打开先按内容撑开一次
  const binary_dialog_box = ref<DialogBox | null>(null)

  watch(
    () => torrent_list.value.length,
    () => {
      structure_dirty.value = true
      // 列表变了，旧的字段记录可能对应到别的种子上，直接作废
      changed_fields.value.clear()
    },
  )

  const is_dirty = computed(() => {
    if (structure_dirty.value) return true

    for (const fields of changed_fields.value.values()) if (fields.size > 0) return true

    return false
  })

  /** 这个字段自己被改过没有（不含子项） */
  function is_field_changed(torrent: Torrent, path: PathKey[]): boolean {
    return changed_fields.value.get(torrent)?.has(path_key(path)) ?? false
  }

  /** 这个字段自己或它下面任意一层有没有未保存的改动 */
  function has_changed_under(torrent: Torrent, path: PathKey[]): boolean {
    const fields = changed_fields.value.get(torrent)
    if (fields === undefined) return false

    // 根节点：只要有任意改动就算
    if (path.length === 0) return fields.size > 0

    const prefix = path_key(path) + SEPARATOR

    for (const key of fields.keys()) if (key.startsWith(prefix)) return true

    return false
  }

  /** 种子上有没有未保存的改动，用来给种子按钮变色 */
  function is_torrent_changed(torrent: Torrent): boolean {
    const fields = changed_fields.value.get(torrent)
    if (fields !== undefined && fields.size > 0) return true

    // 新加进来、还没写进存储的种子
    return !saved_torrents.value.has(torrent)
  }

  /**
   * 记录一次字段修改。before 是改之前的值，after 是改之后的值；
   * 如果改完又变回 before，就把这条记录删掉
   */
  function mark_field_changed(
    torrent: Torrent,
    path: PathKey[],
    before: unknown,
    after: unknown,
  ): void {
    const key = path_key(path)

    let fields = changed_fields.value.get(torrent)
    if (fields === undefined) {
      fields = new Map()
      changed_fields.value.set(torrent, fields)
    }

    const baseline = fields.has(key) ? fields.get(key)?.before : before

    if (is_same_value(baseline, after)) fields.delete(key)
    else fields.set(key, { path: [...path], before: baseline })

    if (fields.size === 0) changed_fields.value.delete(torrent)
  }

  /**
   * 还原某个字段、或某个容器下面所有字段的改动。
   * 传父级路径时，它名下所有子项一起还原
   */
  function revert_changes(torrent: Torrent, path: PathKey[]): void {
    const fields = changed_fields.value.get(torrent)
    if (fields === undefined) return

    const key = path_key(path)
    const prefix = key + SEPARATOR
    const hit = (candidate: string): boolean =>
      candidate === key || (path.length > 0 && candidate.startsWith(prefix))

    const targets: ChangeEntry[] = []
    const hit_keys: string[] = []

    for (const [candidate, entry] of fields) {
      if (!hit(candidate)) continue

      hit_keys.push(candidate)
      targets.push(entry)
    }

    // 深的先还原：万一上层被整体替换过，浅层后写也不会把子层盖掉
    targets.sort((a, b) => b.path.length - a.path.length)

    for (const entry of targets) set_by_path(torrent.data, entry.path, entry.before)

    for (const candidate of hit_keys) fields.delete(candidate)

    if (fields.size === 0) changed_fields.value.delete(torrent)
  }

  // 只有点「Save changes」才写进 localStorage
  function save_changes(): void {
    torrent_data_list.value = torrent_list.value.map((t) => {
      return {
        filename: t.filename,
        buffer_str: bytes_to_base64(t.encode()),
      } as Torrent_data
    })

    changed_fields.value.clear()
    saved_torrents.value = new Set(torrent_list.value)
    structure_dirty.value = false
  }

  return {
    torrent_list,
    binary_dialog_box,
    is_dirty,
    is_field_changed,
    has_changed_under,
    is_torrent_changed,
    mark_field_changed,
    revert_changes,
    save_changes,
  }
})
