<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, type PropType } from 'vue'

import { useMainStore, type DialogBox } from '@/stores/mainStore'

// 一行 16 字节，行高固定，虚拟滚动才能直接算位置
const BYTES_PER_ROW = 16
const ROW_HEIGHT = 22
const OVERSCAN = 6

type HexCell = {
  offset: number
  text: string
}

type HexRow = {
  offset: number
  cells: HexCell[]
  ascii: string
  /** 每次改动自增，让 computed 重新生成单元格（Uint8Array 的下标写入不触发响应式） */
  revision: number
}

const props = defineProps({
  bytes: { type: Object as PropType<Uint8Array>, required: true },
  title: { type: String, required: true },
})

const emit = defineEmits<{
  save: [bytes: Uint8Array]
  close: []
}>()

// 编辑副本，取消时原数据不受影响
const draft = shallowRef<Uint8Array>(new Uint8Array(props.bytes))
const revision = ref(0)
const cursor = ref(0)
// 输一个十六进制数字只改半个字节，记一下现在该填高四位还是低四位
const nibble_high = ref(true)
const scroll_top = ref(0)
const viewport_height = ref(360)
const viewport_ref = ref<HTMLElement | null>(null)
const dialog_ref = ref<HTMLDialogElement | null>(null)
const header_ref = ref<HTMLElement | null>(null)
const footer_ref = ref<HTMLElement | null>(null)

// 弹窗至少留这么高的十六进制区，拖小时不会把内容挤没
const MIN_HEX_HEIGHT = 120
// 拖拽后与视口边缘留点空隙
const VIEWPORT_MARGIN = 16

const main_store = useMainStore()
// store 里存的是用户摆好的位置和大小：关掉弹窗再打开还是它
const { binary_dialog_box: preferred_box } = storeToRefs(main_store)
// 实际显示用的位置和大小：偏好夹进视口后的结果，只是显示层，不回写 store
const box = ref<DialogBox | null>(null)
// 拖动标题栏时给光标和文字选中做点处理
const dragging = ref(false)

const dialog_style = computed(() => {
  const value = box.value
  if (value === null) return undefined

  return {
    left: `${value.left}px`,
    top: `${value.top}px`,
    width: `${value.width}px`,
    height: `${value.height}px`,
  }
})

const total_bytes = computed(() => draft.value.length)
const row_count = computed(() => Math.ceil(total_bytes.value / BYTES_PER_ROW))
const total_height = computed(() => row_count.value * ROW_HEIGHT)

const start_row = computed(() => {
  return Math.max(0, Math.floor(scroll_top.value / ROW_HEIGHT) - OVERSCAN)
})

const end_row = computed(() => {
  const visible = Math.ceil((scroll_top.value + viewport_height.value) / ROW_HEIGHT)

  return Math.min(row_count.value, visible + OVERSCAN)
})

const top_spacer = computed(() => start_row.value * ROW_HEIGHT)
const bottom_spacer = computed(() => {
  return Math.max(0, total_height.value - end_row.value * ROW_HEIGHT)
})

const to_hex = (byte: number): string => byte.toString(16).padStart(2, '0')

const offset_label = (offset: number): string => offset.toString(16).padStart(8, '0')

const ascii_of = (byte: number): string => {
  return byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.'
}

const visible_rows = computed<HexRow[]>(() => {
  const bytes = draft.value
  const stamp = revision.value
  const rows: HexRow[] = []

  for (let row = start_row.value; row < end_row.value; row++) {
    const row_offset = row * BYTES_PER_ROW
    const cells: HexCell[] = []
    let ascii = ''

    for (let i = 0; i < BYTES_PER_ROW; i++) {
      const offset = row_offset + i

      if (offset >= bytes.length) {
        cells.push({ offset, text: '  ' })
        ascii += ' '
        continue
      }

      cells.push({ offset, text: to_hex(bytes[offset]) })
      ascii += ascii_of(bytes[offset])
    }

    rows.push({ offset: row_offset, cells, ascii, revision: stamp })
  }

  return rows
})

const cursor_label = computed(() => offset_label(cursor.value))

const keep_cursor_visible = () => {
  const element = viewport_ref.value
  if (element === null) return

  const row_top = Math.floor(cursor.value / BYTES_PER_ROW) * ROW_HEIGHT

  if (row_top < element.scrollTop) element.scrollTop = row_top
  else if (row_top + ROW_HEIGHT > element.scrollTop + element.clientHeight)
    element.scrollTop = row_top + ROW_HEIGHT - element.clientHeight
}

const move_cursor = (delta: number) => {
  const last = Math.max(0, total_bytes.value - 1)
  cursor.value = Math.min(Math.max(cursor.value + delta, 0), last)
  nibble_high.value = true
  keep_cursor_visible()
}

const select = (offset: number) => {
  if (offset >= total_bytes.value) return

  cursor.value = offset
  nibble_high.value = true
  viewport_ref.value?.focus()
  keep_cursor_visible()
}

const write_nibble = (digit: number) => {
  const bytes = draft.value
  const offset = cursor.value
  if (offset >= bytes.length) return

  const old = bytes[offset]
  bytes[offset] = nibble_high.value ? (digit << 4) | (old & 0x0f) : (old & 0xf0) | digit
  revision.value += 1

  nibble_high.value = !nibble_high.value
  if (nibble_high.value) move_cursor(1)
}

const clear_byte = () => {
  const bytes = draft.value
  if (cursor.value >= bytes.length) return

  bytes[cursor.value] = 0
  revision.value += 1
}

const parse_hex_digit = (key: string): number | null => {
  if (key.length !== 1) return null

  const code = key.toLowerCase().charCodeAt(0)
  if (code >= 48 && code <= 57) return code - 48
  if (code >= 97 && code <= 102) return code - 87

  return null
}

const on_keydown = (event: KeyboardEvent) => {
  const digit = parse_hex_digit(event.key)

  if (digit !== null) {
    event.preventDefault()
    write_nibble(digit)
    return
  }

  switch (event.key) {
    case 'ArrowLeft':
      event.preventDefault()
      move_cursor(-1)
      break
    case 'ArrowRight':
      event.preventDefault()
      move_cursor(1)
      break
    case 'ArrowUp':
      event.preventDefault()
      move_cursor(-BYTES_PER_ROW)
      break
    case 'ArrowDown':
      event.preventDefault()
      move_cursor(BYTES_PER_ROW)
      break
    case 'PageUp':
      event.preventDefault()
      move_cursor(-BYTES_PER_ROW * 16)
      break
    case 'PageDown':
      event.preventDefault()
      move_cursor(BYTES_PER_ROW * 16)
      break
    case 'Home':
      event.preventDefault()
      select(Math.floor(cursor.value / BYTES_PER_ROW) * BYTES_PER_ROW)
      break
    case 'End':
      event.preventDefault()
      select(
        Math.min(
          total_bytes.value - 1,
          Math.floor(cursor.value / BYTES_PER_ROW) * BYTES_PER_ROW + BYTES_PER_ROW - 1,
        ),
      )
      break
    case 'Backspace':
      event.preventDefault()
      clear_byte()
      move_cursor(-1)
      break
    case 'Delete':
      event.preventDefault()
      clear_byte()
      break
  }
}

const on_scroll = (event: Event) => {
  scroll_top.value = (event.currentTarget as HTMLElement).scrollTop
}

const close = () => dialog_ref.value?.close()

const save = () => {
  emit('save', draft.value.slice())
  close()
}

// 点遮罩关闭：dialog 自身没有内边距，点内容时 target 都是子元素
const on_backdrop_click = (event: MouseEvent) => {
  if (event.target === dialog_ref.value) close()
}

// 头部 + 底部固定占掉的高度，十六进制区至少要留 MIN_HEX_HEIGHT
const chrome_height = (): number => {
  return (header_ref.value?.offsetHeight ?? 0) + (footer_ref.value?.offsetHeight ?? 0)
}

// 边框也算在 box-sizing: border-box 的高度里，别让它吃掉内容区
const border_height = (): number => {
  const dialog = dialog_ref.value
  if (dialog === null) return 0

  return Math.max(0, dialog.offsetHeight - dialog.clientHeight)
}

// 尺寸和位置都夹在视口内，拖到屏幕外也不会丢
const clamp_box = (value: DialogBox): DialogBox => {
  const max_width = Math.max(MIN_HEX_HEIGHT, window.innerWidth - VIEWPORT_MARGIN)
  const max_height = Math.max(MIN_HEX_HEIGHT, window.innerHeight - VIEWPORT_MARGIN)
  const min_height = Math.min(chrome_height() + border_height() + MIN_HEX_HEIGHT, max_height)
  const min_width = Math.min(360, max_width)

  const width = Math.min(Math.max(value.width, min_width), max_width)
  const height = Math.min(Math.max(value.height, min_height), max_height)

  return {
    left: Math.min(Math.max(value.left, 0), Math.max(0, window.innerWidth - width)),
    top: Math.min(Math.max(value.top, 0), Math.max(0, window.innerHeight - height)),
    width,
    height,
  }
}

// 第一次打开时把弹窗当前的实际尺寸量进 store，之后由 box 决定；只做一次
const freeze_box = () => {
  const dialog = dialog_ref.value
  if (dialog === null || preferred_box.value !== null) return

  const rect = dialog.getBoundingClientRect()
  const measured = clamp_box({
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  })

  preferred_box.value = measured
  box.value = measured
}

// 视口可能比上次小：只夹显示值，store 里用户摆好的尺寸不动，窗口变回来还能还原
const fit_to_viewport = () => {
  box.value = preferred_box.value === null ? null : clamp_box(preferred_box.value)
}

// 拖动/缩放的结果就是用户想要的位置，同时写进 store
const commit_box = (value: DialogBox) => {
  box.value = value
  preferred_box.value = value
}

// 按下后一直跟踪指针直到抬起：捕获指针后鼠标移出元素、甚至移出弹窗也能继续拖
const track_pointer = (
  event: PointerEvent,
  element: HTMLElement,
  on_move: (move_event: PointerEvent) => void,
  on_end: () => void = () => {},
) => {
  const stop = () => {
    on_end()
    element.removeEventListener('pointermove', on_move)
    element.removeEventListener('pointerup', stop)
    element.removeEventListener('pointercancel', stop)
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
  }

  element.setPointerCapture(event.pointerId)
  element.addEventListener('pointermove', on_move)
  element.addEventListener('pointerup', stop)
  element.addEventListener('pointercancel', stop)
}

// 标题栏：按住拖动整窗挪位置
const start_move = (event: PointerEvent) => {
  if (event.pointerType === 'mouse' && event.button !== 0) return

  const handle = event.currentTarget as HTMLElement
  freeze_box()

  const start = box.value
  if (start === null) return

  event.preventDefault()
  dragging.value = true

  const start_x = event.clientX
  const start_y = event.clientY

  track_pointer(
    event,
    handle,
    (move_event) => {
      commit_box(
        clamp_box({
          ...start,
          left: start.left + (move_event.clientX - start_x),
          top: start.top + (move_event.clientY - start_y),
        }),
      )
    },
    () => {
      dragging.value = false
    },
  )
}

// 右下角手柄：按下的瞬间冻结尺寸，之后跟着指针走
const start_resize = (event: PointerEvent) => {
  if (event.pointerType === 'mouse' && event.button !== 0) return

  const grip = event.currentTarget as HTMLElement
  freeze_box()

  const start = box.value
  if (start === null) return

  event.preventDefault()

  const start_x = event.clientX
  const start_y = event.clientY

  track_pointer(event, grip, (move_event) => {
    commit_box(
      clamp_box({
        ...start,
        width: start.width + (move_event.clientX - start_x),
        height: start.height + (move_event.clientY - start_y),
      }),
    )
  })
}

// 浏览器窗口变小后，已拖大的弹窗先夹进视口；窗口变回去会恢复原来的尺寸
const on_window_resize = () => {
  fit_to_viewport()
}

let resize_observer: ResizeObserver | null = null

onMounted(() => {
  dialog_ref.value?.showModal()

  // 上次摆好的位置和大小还在 store 里：夹进当前视口直接用，不用重新量
  fit_to_viewport()
  // 第一次打开：必须在 showModal 之后量，模态定位会把 dialog 从 absolute 改成 fixed
  freeze_box()

  const element = viewport_ref.value
  if (element !== null) {
    viewport_height.value = element.clientHeight
    element.focus()
  }

  resize_observer = new ResizeObserver(() => {
    if (viewport_ref.value !== null) viewport_height.value = viewport_ref.value.clientHeight
  })
  if (element !== null) resize_observer.observe(element)

  window.addEventListener('resize', on_window_resize)
})

onBeforeUnmount(() => {
  resize_observer?.disconnect()
  window.removeEventListener('resize', on_window_resize)
})
</script>

<template>
  <dialog
    ref="dialog_ref"
    class="binary-dialog"
    :class="{ 'binary-dialog--frozen': box !== null, 'binary-dialog--moving': dragging }"
    :style="dialog_style"
    @close="emit('close')"
    @click="on_backdrop_click"
  >
    <header
      ref="header_ref"
      class="binary-header"
      :class="{ 'binary-header--dragging': dragging }"
      title="Drag to move"
      @pointerdown="start_move"
    >
      <span class="binary-title">{{ title }}</span>
      <span class="binary-meta">{{ total_bytes }} bytes · cursor 0x{{ cursor_label }}</span>
    </header>

    <div
      ref="viewport_ref"
      class="hex-view"
      :style="box === null ? { height: `${total_height + 12}px` } : undefined"
      tabindex="0"
      @scroll.passive="on_scroll"
      @keydown="on_keydown"
    >
      <div :style="{ height: `${top_spacer}px` }"></div>

      <div
        v-for="row in visible_rows"
        :key="row.offset"
        class="hex-row"
        :style="{ height: `${ROW_HEIGHT}px` }"
      >
        <span class="hex-offset">{{ offset_label(row.offset) }}</span>

        <span class="hex-cells">
          <span
            v-for="cell in row.cells"
            :key="cell.offset"
            class="hex-cell"
            :class="{ 'hex-cell--cursor': cell.offset === cursor && cell.offset < total_bytes }"
            @click="select(cell.offset)"
            >{{ cell.text }}</span
          >
        </span>

        <span class="hex-ascii">{{ row.ascii }}</span>
      </div>

      <div :style="{ height: `${bottom_spacer}px` }"></div>

      <div v-if="row_count === 0" class="hex-empty">(0 bytes)</div>
    </div>

    <footer ref="footer_ref" class="binary-actions">
      <span class="binary-hint">
        Click a byte, then type a hex digit; arrow keys move, Backspace clears
      </span>
      <button @click="save">Save</button>
      <button class="secondary" @click="close">Cancel</button>
    </footer>

    <!-- 右下角拖拽手柄：按住拖动改窗口大小 -->
    <div
      v-if="box !== null"
      class="resize-grip"
      title="Drag to resize"
      aria-label="Drag to resize"
      @pointerdown="start_resize"
    ></div>
  </dialog>
</template>

<style scoped>
.binary-dialog {
  width: min(900px, 94vw);
  box-sizing: border-box;
  padding: 0;
  border: 1px solid var(--border-input);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
}

/* 尺寸冻结后由拖拽手柄决定：改成纵向 flex，让十六进制区吃掉剩余高度 */
.binary-dialog--frozen {
  display: flex;
  flex-direction: column;
  position: fixed;
  inset: auto;
  margin: 0;
  /* 盖掉浏览器给模态框的默认上限，否则拖不大 */
  max-width: none;
  max-height: none;
  overflow: hidden;
}

.binary-dialog--frozen .binary-header,
.binary-dialog--frozen .binary-actions {
  flex: none;
}

/* 右下角给拖拽手柄留出位置，别让手柄压住 Cancel */
.binary-dialog--frozen .binary-actions {
  padding-right: 28px;
}

.binary-dialog--frozen .hex-view {
  flex: 1;
  min-height: 0;
  max-height: none;
}

/* 拖拽手柄：位于右下角，只有那两道斜线可点 */
.resize-grip {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 18px;
  height: 18px;
  cursor: nwse-resize;
  /* 触屏上别让浏览器把手势当成滚动 */
  touch-action: none;
}

.resize-grip::after {
  content: '';
  position: absolute;
  right: 3px;
  bottom: 3px;
  width: 7px;
  height: 7px;
  border-right: 2px solid var(--text-faint);
  border-bottom: 2px solid var(--text-faint);
  border-bottom-right-radius: 2px;
}

.resize-grip:hover::after,
.resize-grip:active::after {
  border-color: var(--primary);
}

.binary-dialog::backdrop {
  background: rgba(17, 24, 39, 0.35);
}

/* 遮罩不进文档树，var() 在这里不一定能取到，直接写色值 */
@media (prefers-color-scheme: dark) {
  .binary-dialog::backdrop {
    background: rgba(0, 0, 0, 0.65);
  }
}

.binary-header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px 14px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-subtle);
  /* 标题栏就是移动手柄 */
  cursor: move;
  user-select: none;
  touch-action: none;
}

.binary-header--dragging {
  cursor: grabbing;
}

/* 拖动时指针可能已经离开标题栏，整个弹窗都保持「抓住」光标、且不选中文字 */
.binary-dialog--moving {
  user-select: none;
}

.binary-dialog--moving,
.binary-dialog--moving * {
  cursor: grabbing !important;
}

.binary-title {
  font-weight: 700;
  word-break: break-all;
}

.binary-meta {
  font-size: 12px;
  color: var(--text-muted);
  font-family: ui-monospace, monospace;
}

.hex-view {
  /* 高度由内容撑，超过视口比例才滚动 */
  max-height: 46vh;
  min-height: 120px;
  overflow: auto;
  padding: 6px 0;
  background: var(--inset-bg);
  outline: none;
  font-family: ui-monospace, monospace;
  font-size: 13px;
  line-height: 1;
}

.hex-view:focus-visible {
  box-shadow: inset 0 0 0 2px var(--ring);
}

.hex-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  box-sizing: border-box;
  white-space: nowrap;
}

.hex-offset {
  flex: none;
  color: var(--text-faint);
  font-size: 0.9em;
}

.hex-cells {
  display: flex;
  flex: none;
  gap: 4px;
}

.hex-cell {
  width: 2ch;
  padding: 2px 0;
  text-align: center;
  border-radius: 2px;
  cursor: pointer;
}

.hex-cell:hover {
  background: var(--primary-tint-strong);
}

.hex-cell--cursor {
  background: var(--primary);
  color: var(--on-primary);
}

.hex-cell--cursor:hover {
  background: var(--primary);
}

.hex-ascii {
  flex: none;
  color: var(--text-soft);
  letter-spacing: 0.06em;
}

.hex-empty {
  padding: 12px;
  color: var(--text-faint);
}

.binary-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-top: 1px solid var(--border-subtle);
}

.binary-hint {
  flex: 1;
  font-size: 12px;
  color: var(--text-muted);
}

.binary-actions .secondary {
  background: var(--secondary-bg);
  color: var(--secondary-text);
  box-shadow: none;
}

.binary-actions .secondary:hover {
  background: var(--secondary-bg-hover);
}
</style>
