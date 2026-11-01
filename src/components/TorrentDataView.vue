<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  toRaw,
  watch,
  type PropType,
} from 'vue'

import BinaryEditor from '@/components/BinaryEditor.vue'
import { useMainStore } from '@/stores/mainStore'
import type { Torrent } from '@/torrent'
import {
  build_rows,
  get_by_path,
  parse_like,
  path_of,
  set_by_path,
  type PathKey,
  type TreeRow,
} from '@/tree'

// 普通行高；comment 这类多行字段单独给一个更高的行，直接在行内编辑
const ROW_HEIGHT = 34
const MULTILINE_ROW_HEIGHT = 96
// 视口上下各多渲染几行，滚动时不露白
const OVERSCAN = 8
// 超过这个长度的字符串不直接塞进 input，点开才加载
const LONG_VALUE_LIMIT = 200
// 这些字段本来就是多行文本，行内直接用 textarea
const TEXTAREA_KEYS = new Set<PathKey>(['comment'])

const props = defineProps({
  path: {
    type: Array as PropType<PathKey[]>,
    required: true,
  },
})

const mainStore = useMainStore()
const { torrent_list, is_field_changed, has_changed_under, revert_changes } = mainStore

const expanded = ref(new Set<string>())
// 可见区间（相对本组件顶部的像素偏移）；滚动交给页面滚动条，不再自己滚动
const visible_start = ref(0)
const visible_end = ref(600)
const viewport_ref = ref<HTMLElement | null>(null)
const dialog_ref = ref<HTMLDialogElement | null>(null)
const editing_row = ref<TreeRow | null>(null)
const editing_text = ref('')
const binary_row = ref<TreeRow | null>(null)
// 二进制可能是几 MB，用 shallowRef 避免被包成响应式代理
const binary_bytes = shallowRef<Uint8Array | null>(null)

// 展示的根节点（种子的 data 字段）
const root_value = computed(() => get_by_path(torrent_list, props.path))

// 拍平后的行；只依赖展开状态和根节点身份，改字段值不会重建整张表
const rows = computed<TreeRow[]>(() => {
  return build_rows(toRaw(root_value.value), (key_id) => expanded.value.has(key_id))
})

// 某一行的编辑控件是不是多行文本
const is_multiline = (row: TreeRow): boolean => TEXTAREA_KEYS.has(row.key)

const row_height = (row: TreeRow): number => {
  return is_multiline(row) ? MULTILINE_ROW_HEIGHT : ROW_HEIGHT
}

// 每行顶部的 y 坐标，最后一项是总高度；行高不再恒定，虚拟滚动靠它定位
const row_offsets = computed<number[]>(() => {
  const offsets: number[] = [0]

  for (let i = 0; i < rows.value.length; i++) {
    offsets.push(offsets[i] + row_height(rows.value[i] as TreeRow))
  }

  return offsets
})

const total_height = computed(() => row_offsets.value.at(-1) ?? 0)

// 二分找出包含这个 y 坐标的行：offsets[i] <= offset < offsets[i + 1]
const row_index_at = (offset: number): number => {
  const offsets = row_offsets.value
  const last_index = offsets.length - 2
  if (last_index < 0) return 0

  let low = 0
  let high = offsets.length - 1

  while (low < high) {
    const mid = (low + high) >> 1

    if (offsets[mid] <= offset) low = mid + 1
    else high = mid
  }

  return Math.min(Math.max(low - 1, 0), last_index)
}

const start_index = computed(() => {
  return Math.max(0, row_index_at(visible_start.value) - OVERSCAN)
})

const end_index = computed(() => {
  const last_visible = row_index_at(visible_end.value)

  return Math.min(rows.value.length, last_visible + OVERSCAN + 1)
})

const window_rows = computed(() => rows.value.slice(start_index.value, end_index.value))
const top_spacer = computed(() => row_offsets.value[start_index.value])
const bottom_spacer = computed(() => {
  return Math.max(0, total_height.value - row_offsets.value[end_index.value])
})

// 计算本组件在页面里的可见区间：容器顶边滚出视口多少，就是列表内部可见的起点
const measure = () => {
  const element = viewport_ref.value
  if (element === null) return

  const rect = element.getBoundingClientRect()
  const height = rect.height

  visible_start.value = Math.min(Math.max(-rect.top, 0), height)
  visible_end.value = Math.min(Math.max(window.innerHeight - rect.top, 0), height)
}

// 滚动事件每帧最多算一次，避免一帧里反复读布局
let measure_frame = 0

const schedule_measure = () => {
  if (measure_frame !== 0) return

  measure_frame = requestAnimationFrame(() => {
    measure_frame = 0
    measure()
  })
}

const toggle = (row: TreeRow) => {
  if (row.child_count === 0) return

  if (expanded.value.has(row.key_id)) expanded.value.delete(row.key_id)
  else expanded.value.add(row.key_id)
}

// 只有非空容器才值得点：空对象/空数组点了也没内容
const is_clickable = (row: TreeRow): boolean => row.is_branch && row.child_count > 0

// 整行都是点击热区，不用再瞄准那串文字
const on_row_click = (row: TreeRow) => {
  if (is_clickable(row)) toggle(row)
}

// 只处理落在行本身上的按键：从行内输入框冒泡上来的空格/回车要放行，否则打不出空格
const on_row_keydown = (row: TreeRow, event: KeyboardEvent) => {
  if (event.target !== event.currentTarget || !is_clickable(row)) return

  event.preventDefault()
  toggle(row)
}

// 某一行的值：渲染时才读，响应式依赖落在单个字段上
const row_value = (row: TreeRow): unknown => get_by_path(root_value.value, path_of(row))

// 当前种子的下标就是 props.path 的第一段
const current_torrent = computed<Torrent | undefined>(() => {
  const index = props.path[0]

  return typeof index === 'number' ? torrent_list[index] : undefined
})

const update_value = (row: TreeRow, raw_value: unknown): void => {
  const torrent = current_torrent.value
  if (torrent === undefined) return

  const relative_path = path_of(row)
  const before = get_by_path(torrent.data, relative_path)
  // 输入控件给的是字符串，按原值类型还原；否则数字字段永远算「已改动」
  const after = typeof raw_value === 'string' ? parse_like(before, raw_value) : raw_value

  set_by_path(torrent.data, relative_path, after)
  // 不直接落盘，只记账；点 Save changes 才写 localStorage
  mainStore.mark_field_changed(torrent, relative_path, before, after)
}

// 一行的高亮状态：自己改过 own、只有子项改过 sub、没改过 ''
type ChangeState = '' | 'own' | 'sub'

const change_state = (row: TreeRow): ChangeState => {
  const torrent = current_torrent.value
  if (torrent === undefined) return ''

  const path = path_of(row)

  if (is_field_changed(torrent, path)) return 'own'
  if (has_changed_under(torrent, path)) return 'sub'

  return ''
}

// 叶子还原它自己；容器把它名下所有子项的改动一起还原
const revert_row = (row: TreeRow) => {
  const torrent = current_torrent.value
  if (torrent === undefined) return

  revert_changes(torrent, path_of(row))
}

const open_binary = (row: TreeRow) => {
  const value = toRaw(row_value(row))
  if (!(value instanceof Uint8Array)) return

  binary_row.value = row
  binary_bytes.value = value
}

const close_binary = () => {
  binary_row.value = null
  binary_bytes.value = null
}

const save_binary = (bytes: Uint8Array) => {
  const row = binary_row.value
  if (row !== null) update_value(row, bytes)

  close_binary()
}

const binary_title = computed(() => {
  const row = binary_row.value

  return row === null ? '' : path_of(row).map(display_key).join(' › ')
})

const display_key = (key: PathKey): string => (typeof key === 'number' ? `[${key}]` : key)

const to_text = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  return String(value)
}

const is_binary = (value: unknown): value is Uint8Array => value instanceof Uint8Array

const binary_summary = (bytes: Uint8Array): string => {
  if (bytes.length === 0) return '0 bytes'

  const head = [...bytes.subarray(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join(' ')

  return `${bytes.length} bytes · ${head}${bytes.length > 16 ? ' …' : ''}`
}

const needs_dialog = (value: unknown): boolean => {
  return typeof value === 'string' && value.length > LONG_VALUE_LIMIT
}

const value_preview = (value: unknown): string => {
  const text = to_text(value).replaceAll('\n', ' ')
  const clipped = text.length > 60 ? `${text.slice(0, 60)}…` : text

  return `${clipped} (${text.length} chars, click to edit)`
}

const open_dialog = (row: TreeRow) => {
  editing_row.value = row
  editing_text.value = to_text(row_value(row))
  dialog_ref.value?.showModal()
}

const close_dialog = () => dialog_ref.value?.close()

const save_dialog = () => {
  const row = editing_row.value
  if (row !== null) update_value(row, editing_text.value)

  close_dialog()
}

// 改过的行用琥珀底色盖掉层级底色，层级本身还有缩进可看
const row_background = (depth: number, state: ChangeState): string => {
  if (state === 'own') return 'rgba(245, 158, 11, 0.2)'
  if (state === 'sub') return 'rgba(245, 158, 11, 0.08)'

  return `rgba(100, 150, 255, ${0.05 + Math.min(depth * 0.035, 0.25)})`
}

let body_observer: ResizeObserver | null = null

onMounted(() => {
  measure()

  window.addEventListener('scroll', schedule_measure, { passive: true })
  window.addEventListener('resize', schedule_measure)

  // 上方内容（比如 About 面板）展开会把本组件往下推，需要重新量一次
  body_observer = new ResizeObserver(schedule_measure)
  body_observer.observe(document.body)
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', schedule_measure)
  window.removeEventListener('resize', schedule_measure)
  body_observer?.disconnect()

  if (measure_frame !== 0) cancelAnimationFrame(measure_frame)
})

// 展开/收起会改变总高度，量一次保证可见区间跟着更新
watch(total_height, async () => {
  await nextTick()
  measure()
})

// 换种子后，如果列表顶部已经滚出视口，就回到列表开头
watch(root_value, async () => {
  const element = viewport_ref.value
  if (element !== null && element.getBoundingClientRect().top < 0)
    element.scrollIntoView({ block: 'start' })

  await nextTick()
  measure()
})
</script>

<template>
  <div ref="viewport_ref" class="data-view">
    <div :style="{ height: `${top_spacer}px` }"></div>

    <div
      v-for="row in window_rows"
      :key="row.key_id"
      class="data-row"
      :class="{
        'data-row--multiline': is_multiline(row),
        'data-row--clickable': is_clickable(row),
        'data-row--changed': change_state(row) === 'own',
        'data-row--changed-parent': change_state(row) === 'sub',
      }"
      :style="{
        height: `${row_height(row)}px`,
        paddingLeft: `${6 + row.depth * 14}px`,
        backgroundColor: row_background(row.depth, change_state(row)),
      }"
      :role="is_clickable(row) ? 'button' : undefined"
      :tabindex="is_clickable(row) ? 0 : undefined"
      :aria-expanded="is_clickable(row) ? expanded.has(row.key_id) : undefined"
      @click="on_row_click(row)"
      @keydown.enter="on_row_keydown(row, $event)"
      @keydown.space="on_row_keydown(row, $event)"
    >
      <!-- 可展开的节点：点整行任意位置都能展开 -->
      <span
        v-if="row.is_branch"
        class="node-toggle"
        :class="{ 'node-toggle--empty': row.child_count === 0 }"
      >
        <span class="arrow">
          {{ row.child_count === 0 ? '' : expanded.has(row.key_id) ? '▼' : '▶' }}
        </span>
        <span class="node-key">{{ display_key(row.key) }}</span>
        <span class="node-count">{{ row.child_count }}</span>
      </span>

      <!-- 叶子节点 -->
      <template v-else>
        <span class="node-key">{{ display_key(row.key) }}:</span>

        <button v-if="is_binary(row_value(row))" class="binary-value" @click="open_binary(row)">
          {{ binary_summary(row_value(row) as Uint8Array) }}
        </button>

        <!-- comment 这类多行字段：行内 textarea，直接编辑无需弹窗 -->
        <textarea
          v-else-if="is_multiline(row)"
          class="node-textarea"
          :value="to_text(row_value(row))"
          spellcheck="false"
          @input="update_value(row, ($event.target as HTMLTextAreaElement).value)"
        ></textarea>

        <button
          v-else-if="needs_dialog(row_value(row))"
          class="long-value"
          @click="open_dialog(row)"
        >
          {{ value_preview(row_value(row)) }}
        </button>

        <input
          v-else
          class="node-value"
          type="text"
          :value="to_text(row_value(row))"
          @input="update_value(row, ($event.target as HTMLInputElement).value)"
        />
      </template>

      <!-- 有未保存改动的行：右侧一键还原；容器会把它名下所有子项的改动一起还原 -->
      <button
        v-if="change_state(row) !== ''"
        class="revert-button"
        :title="
          change_state(row) === 'own' ? 'Revert this field' : 'Revert every change under this item'
        "
        aria-label="Revert changes"
        @click.stop="revert_row(row)"
      >
        ↺
      </button>
    </div>

    <div :style="{ height: `${bottom_spacer}px` }"></div>

    <div v-if="rows.length === 0" class="empty-hint">(empty)</div>
  </div>

  <!-- 长文本/多行字段：点开才把完整内容放进 DOM -->
  <dialog ref="dialog_ref" class="value-dialog" @close="editing_row = null">
    <div class="dialog-title">{{ editing_row === null ? '' : display_key(editing_row.key) }}</div>

    <textarea v-model="editing_text" class="dialog-text" spellcheck="false"></textarea>

    <div class="dialog-actions">
      <button @click="save_dialog">Save</button>
      <button class="secondary" @click="close_dialog">Cancel</button>
    </div>
  </dialog>

  <!-- 二进制字段：点开十六进制编辑器 -->
  <BinaryEditor
    v-if="binary_bytes !== null"
    :bytes="binary_bytes"
    :title="binary_title"
    @save="save_binary"
    @close="close_binary"
  />
</template>

<style scoped>
/* 不设高度、不自己滚动：内容撑多高页面就多高，用浏览器默认滚动条 */
.data-view {
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
  font-size: 15px;
}

.data-row {
  display: flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  padding-right: 8px;
  overflow: hidden;
  white-space: nowrap;
}

/* 可展开的行整行都是热区，悬停时给一条浅色底和一个左侧色条 */
.data-row--clickable {
  position: relative;
  cursor: pointer;
}

/* 用内阴影做悬停底色，避免和行内联的 backgroundColor 打架 */
.data-row--clickable:hover {
  box-shadow:
    inset 3px 0 0 var(--primary),
    inset 0 0 0 999px var(--primary-row-tint);
}

.data-row--clickable:hover .node-key,
.data-row--clickable:hover .arrow {
  color: var(--primary-text);
}

.data-row--clickable:focus-visible {
  outline: none;
  box-shadow:
    inset 3px 0 0 var(--primary),
    inset 0 0 0 999px var(--primary-row-tint-strong),
    inset 0 0 0 2px var(--primary);
}

/* 改动过的字段换一套颜色，提示还没保存 */
.data-row--changed .node-key,
.data-row--changed .node-count,
.data-row--changed .long-value,
.data-row--changed .binary-value {
  color: var(--changed-text);
}

.data-row--changed .node-value,
.data-row--changed .node-textarea {
  border-color: var(--changed-border);
  background: var(--changed-bg);
  color: var(--changed-text);
}

/* 只有子项改过的行：颜色浅一档，表示「这一层下面有未保存的改动」 */
.data-row--changed-parent .node-key,
.data-row--changed-parent .node-count {
  color: var(--changed-text-soft);
}

/* 改过的行悬停时仍用琥珀色，别被通用的主色悬停盖掉 */
.data-row--changed.data-row--clickable:hover,
.data-row--changed-parent.data-row--clickable:hover {
  box-shadow:
    inset 3px 0 0 var(--changed-text),
    inset 0 0 0 999px var(--changed-row-tint);
}

.data-row--changed.data-row--clickable:hover .node-key,
.data-row--changed.data-row--clickable:hover .arrow,
.data-row--changed-parent.data-row--clickable:hover .node-key,
.data-row--changed-parent.data-row--clickable:hover .arrow {
  color: var(--changed-text);
}

/* 行尾的还原按钮：小圆钮，要盖掉全局的实心按钮样式 */
.revert-button {
  align-self: center;
  flex: none;
  width: 22px;
  height: 22px;
  margin-left: auto;
  padding: 0;
  border: 1px solid var(--changed-border);
  border-radius: 50%;
  background: var(--changed-bg);
  color: var(--changed-text);
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
  box-shadow: none;
}

.revert-button:hover {
  background: var(--changed-bg-hover);
  color: var(--changed-text-hover);
  box-shadow: none;
}

.revert-button:active {
  background: var(--changed-bg-active);
  transform: none;
  box-shadow: none;
}

/* 多行字段的行：让 textarea 撑满整行高度 */
.data-row--multiline {
  align-items: stretch;
  padding-top: 4px;
  padding-bottom: 4px;
}

/* 行内的按钮要盖掉全局的实心按钮样式 */
.node-toggle,
.long-value {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 4px;
  min-width: 0;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: none;
  color: inherit;
  font: inherit;
  font-weight: 400;
  line-height: 1;
  box-shadow: none;
  overflow: hidden;
}

/* 长文本预览按钮仍是真按钮，要盖掉全局的实心样式 */
.long-value:hover {
  background: var(--primary-tint);
  box-shadow: none;
  color: var(--primary-text);
}

.long-value:active {
  background: var(--primary-tint-strong);
  box-shadow: none;
}

/* 空容器点开也没内容，弱化显示且不给手型（行本身也不可点） */
.node-toggle--empty .node-key {
  opacity: 0.55;
}

.arrow {
  flex: none;
  width: 1em;
  font-size: 0.7em;
  opacity: 0.7;
}

.node-key {
  flex: none;
  font-weight: 700;
}

.node-count {
  flex: none;
  font-size: 0.78em;
  font-weight: 400;
  color: var(--text-muted);
}

.node-value {
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--border-input);
  border-radius: 3px;
  background: var(--field-bg);
  color: var(--text);
  font: inherit;
}

.node-value:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 2px var(--ring-soft);
}

.node-textarea {
  flex: 1;
  min-width: 0;
  height: 100%;
  box-sizing: border-box;
  padding: 3px 6px;
  border: 1px solid var(--border-input);
  border-radius: 3px;
  background: var(--field-bg);
  color: var(--text);
  font: inherit;
  line-height: 1.4;
  white-space: pre-wrap;
  resize: none;
}

.node-textarea:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 2px var(--ring-soft);
}

/* 改过的控件聚焦时也保持琥珀色，别让主色盖掉「未保存」的提示 */
.data-row--changed .node-value:focus,
.data-row--changed .node-textarea:focus {
  border-color: var(--changed-border);
  box-shadow: 0 0 0 2px var(--changed-ring);
}

/* 二进制字段：点击打开十六进制编辑器，样式做成可点的字段 */
.binary-value {
  display: inline-flex;
  flex: 1;
  align-items: center;
  justify-content: flex-start;
  min-width: 0;
  height: 26px;
  padding: 0 8px;
  border: 1px dashed var(--border-input);
  border-radius: 3px;
  background: var(--surface-subtle);
  color: var(--text-soft);
  font-family: ui-monospace, monospace;
  font-size: 0.9em;
  font-weight: 400;
  line-height: 1;
  box-shadow: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.binary-value:hover {
  border-color: var(--primary-border-soft);
  background: var(--primary-tint);
  color: var(--primary-text);
  box-shadow: none;
}

.binary-value:active {
  background: var(--primary-tint-strong);
  box-shadow: none;
}

.long-value {
  flex: 1;
  height: 26px;
  padding: 0 8px;
  border: 1px dashed var(--border-input);
  background: var(--surface-muted);
  color: var(--text-soft);
}

.empty-hint {
  padding: 12px;
  color: var(--text-faint);
}

.value-dialog {
  width: min(760px, 92vw);
  padding: 14px;
  border: 1px solid var(--border-input);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
}

.value-dialog::backdrop {
  background: rgba(17, 24, 39, 0.35);
}

/* 遮罩不进文档树，var() 在这里不一定能取到，直接写色值 */
@media (prefers-color-scheme: dark) {
  .value-dialog::backdrop {
    background: rgba(0, 0, 0, 0.65);
  }
}

.dialog-title {
  margin-bottom: 8px;
  font-weight: 700;
  word-break: break-all;
}

.dialog-text {
  width: 100%;
  height: 40vh;
  box-sizing: border-box;
  padding: 8px;
  border: 1px solid var(--border-input);
  border-radius: 4px;
  background: var(--field-bg);
  color: var(--text);
  font-family: ui-monospace, monospace;
  font-size: 13px;
  resize: vertical;
}

/* 不盖掉的话，暗色下浏览器默认聚焦描边是一圈刺眼的白 */
.dialog-text:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 2px var(--ring-soft);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.dialog-actions .secondary {
  background: var(--secondary-bg);
  color: var(--secondary-text);
  box-shadow: none;
}

.dialog-actions .secondary:hover {
  background: var(--secondary-bg-hover);
}
</style>
