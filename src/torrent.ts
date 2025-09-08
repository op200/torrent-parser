import { Buffer } from 'buffer'
import bencode from 'bencode'

type Primitive = string | number | boolean | null
type BencodeValue = Primitive | BencodeValue[] | { [key: string]: BencodeValue }
type Converted<T> = T extends Uint8Array
    ? string
    : T extends object
    ? { [K in keyof T]: Converted<T[K]> }
    : T

function convertUint8Arrays<T>(obj: T): Converted<T> {
    // 处理 Uint8Array
    if (obj instanceof Uint8Array) {
        return new TextDecoder('utf-8').decode(obj) as Converted<T>
    }

    // 处理数组
    if (Array.isArray(obj)) {
        return obj.map(convertUint8Arrays) as Converted<T>
    }

    // 处理普通对象
    if (obj && typeof obj === 'object') {
        const result: Record<string, any> = {}
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key))
                if (new Set(['pieces', 'pieces root']).has(key) || key.length == 64)
                    result[key] = obj[key]
                else
                    result[key] = convertUint8Arrays(obj[key])
        }
        return result as Converted<T>
    }

    // 基本类型直接返回
    return obj as Converted<T>
}


export default class Torrent {
    filename: string
    data

    constructor(buffer: ArrayBuffer | Buffer, filename = "") {
        if (buffer instanceof ArrayBuffer)
            this.data = convertUint8Arrays(
                bencode.decode(Buffer.from(buffer))
            )
        else
            this.data = convertUint8Arrays(
                bencode.decode(buffer)
            )

        this.filename = filename
    }

    encode() {
        return bencode.encode(this.data)
    }
}
