import { watch, type Ref } from 'vue'

const STORAGE_KEY_PREFIX = 'torrent-parser_'

/**
 * 把 ref 绑定到 localStorage：先读取已保存的值，之后深度监听变化并写回
 * @param refVar 要绑定的 ref
 * @param name 存储键名（自动加前缀）
 */
export function set_local_store<T>(refVar: Ref<T>, name: string): void {
  const storage_key = STORAGE_KEY_PREFIX + name
  const json_str = localStorage.getItem(storage_key)

  if (json_str !== null && json_str !== '') refVar.value = JSON.parse(json_str) as T

  watch(
    refVar,
    () => {
      localStorage.setItem(storage_key, JSON.stringify(refVar.value))
    },
    { deep: true },
  )
}

/**
 * 复制文本到剪贴板
 * @param text 要复制的字符串
 * @returns Promise<boolean> 是否成功
 */
export async function copy_to_clipboard(text: string | undefined): Promise<boolean> {
  if (text === undefined) return false

  try {
    // 使用现代 Clipboard API
    await navigator.clipboard.writeText(text)
    return true
  } catch (err) {
    console.error('Copy failed:', err)
    return fallback_copy(text) // 降级方案
  }
}

// 降级方案（兼容旧浏览器）
function fallback_copy(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed' // 避免滚动
  document.body.appendChild(textarea)
  textarea.select()

  try {
    const success = document.execCommand('copy')
    document.body.removeChild(textarea)
    return success
  } catch (err) {
    console.error('Fallback copy failed:', err)
    document.body.removeChild(textarea)
    return false
  }
}

// fromCharCode 的实参个数有上限，分块处理
const BASE64_CHUNK_SIZE = 0x8000

/**
 * 把字节数组编码成标准 base64（与 Node 的 Buffer.toString("base64") 输出一致）
 * @param bytes 字节数组
 */
export function bytes_to_base64(bytes: Uint8Array): string {
  let binary = ''

  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK_SIZE))
  }

  return btoa(binary)
}

/**
 * 把标准 base64 解码成字节数组
 * @param base64 标准 base64 字符串
 */
export function base64_to_bytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

  return bytes
}
