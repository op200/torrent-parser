import bencode from 'bencode'

type Converted<T> = T extends Uint8Array
  ? string
  : T extends object
    ? { [K in keyof T]: Converted<T[K]> }
    : T

function convert_uint8_arrays<T>(obj: T): Converted<T> {
  // 处理 Uint8Array
  if (obj instanceof Uint8Array) {
    return new TextDecoder('utf-8').decode(obj) as Converted<T>
  }

  // 处理数组
  if (Array.isArray(obj)) {
    return obj.map(convert_uint8_arrays) as Converted<T>
  }

  // 处理普通对象
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key))
        if (new Set(['pieces', 'pieces root']).has(key) || key.length >= 32) result[key] = obj[key]
        else result[key] = convert_uint8_arrays(obj[key])
    }
    return result as Converted<T>
  }

  // 基本类型直接返回
  return obj as Converted<T>
}

/**
 * 用浏览器内置的 Web Crypto 计算摘要，输出小写十六进制
 * 注意：crypto.subtle 只在安全上下文（https 或 localhost）下可用
 */
async function digest_hex(algorithm: 'SHA-1' | 'SHA-256', data: Uint8Array): Promise<string> {
  if (!crypto.subtle) {
    throw new Error('Web Crypto API is unavailable, please use https or localhost')
  }

  const bytes = await crypto.subtle.digest(algorithm, data as Uint8Array<ArrayBuffer>)
  const digest = new Uint8Array(bytes)

  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export enum Torrent_format {
  v1 = 'BT v1',
  v2 = 'BT v2',
  hybrid = 'BT v2-Hybrid',
}

export class Torrent {
  filename: string
  data

  constructor(buffer: ArrayBuffer | Uint8Array, filename: string = '') {
    this.filename = filename

    if (buffer instanceof ArrayBuffer)
      this.data = convert_uint8_arrays(bencode.decode(new Uint8Array(buffer)))
    else this.data = convert_uint8_arrays(bencode.decode(buffer))

    // if (this.get_format() !== Torrent_format.v1)
    //     this.data.info["pieces"] = []
  }

  get_format(): Torrent_format {
    if (this.data.info['meta version'] === 2)
      if (this.data.info?.files || this.data.info?.length) return Torrent_format.hybrid
      else return Torrent_format.v2
    return Torrent_format.v1
  }

  async get_hash_v1(): Promise<string> {
    if (this.get_format() === Torrent_format.v2) return ''

    return digest_hex('SHA-1', bencode.encode(this.data.info))
  }

  async get_hash_v2(): Promise<string> {
    if (this.get_format() === Torrent_format.v1) return ''

    return digest_hex('SHA-256', bencode.encode(this.data.info))
  }

  encode(): Uint8Array {
    return bencode.encode(this.data)
  }

  async generate_magnet(): Promise<string> {
    const magnet_str_list: string[] = []

    switch (this.get_format()) {
      case Torrent_format.v1:
        magnet_str_list.push('xt=urn:btih:' + (await this.get_hash_v1()))
        break
      case Torrent_format.v2:
        magnet_str_list.push('xt=urn:btmh:1220' + (await this.get_hash_v2()))
        break
      case Torrent_format.hybrid:
        magnet_str_list.push('xt=urn:btih:' + (await this.get_hash_v1()))
        magnet_str_list.push('xt=urn:btmh:1220' + (await this.get_hash_v2()))
        break
    }

    return 'magnet:?' + magnet_str_list.join('&')
  }
}
